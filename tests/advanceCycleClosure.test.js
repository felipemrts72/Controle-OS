import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import { closeCycle, getAdvancesHome } from '../backend/src/services/advanceService.js';

const fixture = {
  cycleId: randomUUID(),
  listId: randomUUID(),
  itemId: randomUUID(),
  deletedListId: randomUUID(),
  deletedItemId: randomUUID(),
  planId: randomUUID(),
  installmentId: randomUUID(),
};

let realBaseline;
let user;
let employee;

async function realAdvanceState() {
  const [cycles, relations] = await Promise.all([
    pool.query(`SELECT id, status, opened_at, opened_by, closed_at, closed_by, notes
      FROM advance_cycles ORDER BY id`),
    pool.query(`SELECT
      COUNT(DISTINCT al.id)::int AS lists,
      COUNT(ali.id)::int AS items,
      COALESCE(SUM(ali.amount), 0)::numeric AS total
      FROM advance_lists al LEFT JOIN advance_list_items ali ON ali.list_id = al.id`),
  ]);
  return { cycles: cycles.rows, relations: relations.rows[0] };
}

async function setupOpenFixture(client) {
  await client.query(
    `UPDATE advance_cycles
     SET status = 'closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
     WHERE status = 'open'`,
    [user.id],
  );
  await client.query(
    `INSERT INTO advance_cycles (id, status, opened_by)
     VALUES ($1, 'open', $2)`,
    [fixture.cycleId, user.id],
  );
  await client.query(
    `INSERT INTO advance_lists (id, cycle_id, list_date, status, created_by, updated_by, approved_by, approved_at)
     VALUES ($1, $2, CURRENT_DATE, 'approved', $3, $3, $3, NOW())`,
    [fixture.listId, fixture.cycleId, user.id],
  );
  await client.query(
    `INSERT INTO advance_list_items (
      id, list_id, employee_id, amount, status, confirmed, created_by, updated_by
     ) VALUES ($1, $2, $3, 125.50, 'active', TRUE, $4, $4)`,
    [fixture.itemId, fixture.listId, employee.id, user.id],
  );
  await client.query(
    `INSERT INTO advance_lists (
      id, cycle_id, list_date, status, created_by, updated_by, deleted_at, deleted_by
     ) VALUES ($1, $2, CURRENT_DATE, 'cancelled', $3, $3, NOW(), $3)`,
    [fixture.deletedListId, fixture.cycleId, user.id],
  );
  await client.query(
    `INSERT INTO advance_list_items (
      id, list_id, employee_id, amount, status, confirmed, created_by, updated_by, removed_at, removed_by
     ) VALUES ($1, $2, $3, 10, 'removed', TRUE, $4, $4, NOW(), $4)`,
    [fixture.deletedItemId, fixture.deletedListId, employee.id, user.id],
  );
  await client.query(
    `INSERT INTO advance_installment_plans (
      id, employee_id, original_amount, installments_count, status, created_by
     ) VALUES ($1, $2, 30, 1, 'active', $3)`,
    [fixture.planId, employee.id, user.id],
  );
  await client.query(
    `INSERT INTO advance_installments (
      id, plan_id, installment_number, installment_amount, status
     ) VALUES ($1, $2, 1, 30, 'pending')`,
    [fixture.installmentId, fixture.planId],
  );
}

async function withForcedRollback(action, { setup = setupOpenFixture, inspect, failNextCycleCreation = false } = {}) {
  const originalConnect = pool.connect.bind(pool);
  let inspection;
  let rolledBack = false;
  pool.connect = async () => {
    const actual = await originalConnect();
    return {
      async query(text, params) {
        const sql = typeof text === 'string' ? text.trim() : '';
        const command = sql.toUpperCase();
        if (command === 'BEGIN') {
          const result = await actual.query(text, params);
          if (setup) await setup(actual);
          return result;
        }
        if (failNextCycleCreation && /INSERT\s+INTO\s+advance_cycles/i.test(sql)) {
          const error = new Error('falha simulada ao criar o novo ciclo');
          error.code = 'TEST_NEXT_CYCLE_FAILURE';
          throw error;
        }
        if (command === 'COMMIT') {
          try {
            if (inspect) inspection = await inspect(actual);
          } finally {
            await actual.query('ROLLBACK');
            rolledBack = true;
          }
          return { rows: [], rowCount: 0 };
        }
        if (command === 'ROLLBACK') {
          rolledBack = true;
          return actual.query('ROLLBACK');
        }
        return actual.query(text, params);
      },
      release: () => actual.release(),
    };
  };

  try {
    const value = await action();
    return { value, inspection, rolledBack };
  } finally {
    pool.connect = originalConnect;
  }
}

before(async () => {
  const userResult = await pool.query(
    `SELECT u.id, u.role, r.slug AS role_slug
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = TRUE AND u.approval_status = 'approved'
     ORDER BY (r.slug = 'admin' OR u.role = 'admin') DESC, u.id LIMIT 1`,
  );
  const employeeResult = await pool.query(
    `SELECT id, full_name, current_salary, employment_status
     FROM employees WHERE deleted_at IS NULL ORDER BY id LIMIT 1`,
  );
  assert.ok(userResult.rows[0] && employeeResult.rows[0], 'as fixtures requerem um usuário e um funcionário');
  user = { ...userResult.rows[0], is_super_admin: true, permissions: [] };
  employee = employeeResult.rows[0];
  realBaseline = await realAdvanceState();
});

after(async () => {
  if (realBaseline) assert.deepEqual(await realAdvanceState(), realBaseline);
  await pool.end();
});

test('obtém o ciclo aberto', async () => {
  const run = await withForcedRollback(() => getAdvancesHome());
  assert.equal(run.value.open_cycle.id, fixture.cycleId);
  assert.equal(run.value.open_cycle.status, 'open');
  assert.equal(run.value.open_cycle.list_count, 1);
  assert.equal(run.value.open_cycle.item_count, 1);
  assert.equal(run.value.open_cycle.employee_count, 1);
  assert.equal(Number(run.value.open_cycle.total_amount), 125.5);
});

test('fecha um ciclo aberto válido', async () => {
  const run = await withForcedRollback(
    () => closeCycle(fixture.cycleId, { start_new: false }, user),
    { inspect: async (client) => (await client.query('SELECT status, closed_at, closed_by FROM advance_cycles WHERE id = $1', [fixture.cycleId])).rows[0] },
  );
  assert.equal(run.value.closed_cycle.status, 'closed');
  assert.equal(run.inspection.status, 'closed');
  assert.equal(run.inspection.closed_by, user.id);
  assert.ok(run.inspection.closed_at);
  assert.equal(run.rolledBack, true);
});

test('rejeita ID de ciclo inexistente', async () => {
  await assert.rejects(
    () => withForcedRollback(() => closeCycle(randomUUID(), { start_new: false }, user)),
    (error) => error.status === 404 && /Ciclo nao encontrado/.test(error.message),
  );
});

test('rejeita ciclo já fechado', async () => {
  const closedId = randomUUID();
  await assert.rejects(
    () => withForcedRollback(
      () => closeCycle(closedId, { start_new: false }, user),
      {
        setup: (client) => client.query(
          `INSERT INTO advance_cycles (id, status, opened_by, closed_at, closed_by)
           VALUES ($1, 'closed', $2, NOW(), $2)`,
          [closedId, user.id],
        ),
      },
    ),
    (error) => error.status === 400 && /Ciclo ja esta fechado/.test(error.message),
  );
});

test('fecha ciclo com listas sem remover listas ou itens', async () => {
  const run = await withForcedRollback(
    () => closeCycle(fixture.cycleId, { start_new: false }, user),
    {
      inspect: async (client) => (await client.query(
        `SELECT COUNT(DISTINCT al.id) FILTER (WHERE al.deleted_at IS NULL)::int AS lists,
          COUNT(ali.id) FILTER (WHERE al.deleted_at IS NULL AND ali.status = 'active' AND ali.removed_at IS NULL)::int AS items
         FROM advance_lists al LEFT JOIN advance_list_items ali ON ali.list_id = al.id
         WHERE al.cycle_id = $1`,
        [fixture.cycleId],
      )).rows[0],
    },
  );
  assert.deepEqual(run.inspection, { lists: 1, items: 1 });
});

test('preserva listas e itens históricos', async () => {
  const run = await withForcedRollback(
    () => closeCycle(fixture.cycleId, { start_new: false }, user),
    {
      inspect: async (client) => (await client.query(
        `SELECT COUNT(DISTINCT al.id)::int AS lists, COUNT(ali.id)::int AS items
         FROM advance_lists al LEFT JOIN advance_list_items ali ON ali.list_id = al.id
         WHERE al.cycle_id = $1 AND al.deleted_at IS NOT NULL`,
        [fixture.cycleId],
      )).rows[0],
    },
  );
  assert.deepEqual(run.inspection, { lists: 1, items: 1 });
});

test('fecha o ciclo e inicia outro na mesma transação', async () => {
  const run = await withForcedRollback(
    () => closeCycle(fixture.cycleId, { start_new: true }, user),
    {
      inspect: async (client) => (await client.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
          COUNT(*) FILTER (WHERE status = 'closed' AND id = $1)::int AS old_closed
         FROM advance_cycles`,
        [fixture.cycleId],
      )).rows[0],
    },
  );
  assert.equal(run.value.closed_cycle.status, 'closed');
  assert.equal(run.value.next_cycle.status, 'open');
  assert.deepEqual(run.inspection, { open_count: 1, old_closed: 1 });
});

test('novo ciclo começa aberto e parcela usa o ID do funcionário', async () => {
  const run = await withForcedRollback(
    () => closeCycle(fixture.cycleId, { start_new: true }, user),
    {
      inspect: async (client) => (await client.query(
        `SELECT ai.status, ali.employee_id
         FROM advance_installments ai
         JOIN advance_list_items ali ON ali.id = ai.posted_advance_item_id
         WHERE ai.id = $1`,
        [fixture.installmentId],
      )).rows[0],
    },
  );
  assert.equal(run.value.next_cycle.status, 'open');
  assert.deepEqual(run.inspection, { status: 'posted', employee_id: employee.id });
});

test('falha ao criar o novo ciclo reverte o fechamento', async () => {
  await assert.rejects(
    () => withForcedRollback(
      () => closeCycle(fixture.cycleId, { start_new: true }, user),
      { failNextCycleCreation: true },
    ),
    (error) => error.code === 'TEST_NEXT_CYCLE_FAILURE',
  );
  assert.deepEqual(await realAdvanceState(), realBaseline);
});

test('fechamento composto não duplica ciclos abertos', async () => {
  const run = await withForcedRollback(
    () => closeCycle(fixture.cycleId, { start_new: true }, user),
    {
      inspect: async (client) => (await client.query(
        "SELECT COUNT(*)::int AS count FROM advance_cycles WHERE status = 'open'",
      )).rows[0],
    },
  );
  assert.equal(run.inspection.count, 1);
});

test('fixtures e ensaios não alteram os dados reais', async () => {
  assert.deepEqual(await realAdvanceState(), realBaseline);
});
