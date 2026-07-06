import { transaction } from '../database/pool.js';
import { logAudit } from './auditService.js';
import { hasPermission } from './permissionService.js';
import { httpError } from '../utils/httpError.js';

const listStatusLabels = {
  draft: 'Em edicao',
  pending_approval: 'Aguardando aprovacao',
  approved: 'Aprovada',
  cancelled: 'Cancelada',
};

function can(user, permission, manageFallback = true) {
  return hasPermission(user, permission) || (manageFallback && hasPermission(user, 'advances.manage'));
}

function assertCan(user, permission) {
  if (!can(user, permission)) throw httpError(403, 'Acesso nao autorizado.');
}

function money(value, field = 'valor') {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw httpError(400, `Informe um ${field} valido.`);
  return Math.round(number * 100) / 100;
}

function dateOrToday(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, 'Data da lista invalida.');
  return text;
}

function toNumber(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

function buildLimitDetails({ employee, salary, accumulatedBefore, amount }) {
  const lowSalary = salary <= 1999.99;
  const warningPercentage = 40;
  const maximumPercentage = lowSalary ? 40 : 60;
  const warningLimit = salary * 0.4;
  const maximumLimit = salary * (maximumPercentage / 100);
  const projectedTotal = accumulatedBefore + amount;
  const projectedPercentage = salary > 0 ? (projectedTotal / salary) * 100 : null;
  const remaining = Math.max(0, maximumLimit - accumulatedBefore);

  return {
    employee_id: employee.id,
    employee_name: employee.full_name,
    salary,
    amount,
    accumulated_before: accumulatedBefore,
    projected_total: projectedTotal,
    projected_percentage: projectedPercentage,
    warning_percentage: warningPercentage,
    warning_limit: warningLimit,
    maximum_percentage: maximumPercentage,
    maximum_limit: maximumLimit,
    remaining,
    low_salary: lowSalary,
  };
}

function buildSalaryMissingDetails({ employee, amount, accumulatedBefore }) {
  return {
    employee_id: employee.id,
    employee_name: employee.full_name,
    salary: null,
    amount,
    accumulated_before: accumulatedBefore,
    projected_total: accumulatedBefore + amount,
    remaining: 0,
  };
}

async function fetchList(client, listId, lock = false) {
  const result = await client.query(
    `SELECT al.*, ac.status AS cycle_status, ac.opened_at, ac.closed_at
     FROM advance_lists al
     JOIN advance_cycles ac ON ac.id = al.cycle_id
     WHERE al.id = $1
     ${lock ? 'FOR UPDATE OF al' : ''}`,
    [listId],
  );
  if (!result.rows[0]) throw httpError(404, 'Lista de vales nao encontrada.');
  return result.rows[0];
}

async function fetchEmployeeForAdvance(client, employeeId, lock = false, allowTerminated = false) {
  const result = await client.query(
    `SELECT id, full_name, current_salary, employment_status
     FROM employees
     WHERE id = $1 AND deleted_at IS NULL
     ${lock ? 'FOR UPDATE' : ''}`,
    [employeeId],
  );
  const employee = result.rows[0];
  if (!employee) throw httpError(404, 'Funcionario nao encontrado.');
  if (!allowTerminated && employee.employment_status === 'desligado') throw httpError(400, 'Funcionario desligado nao pode receber vale.');
  return employee;
}

async function accumulatedInCycle(client, cycleId, employeeId, excludingItemId = null) {
  const params = [cycleId, employeeId];
  let excludeSql = '';
  if (excludingItemId) {
    params.push(excludingItemId);
    excludeSql = `AND ali.id <> $${params.length}`;
  }
  const result = await client.query(
    `SELECT COALESCE(SUM(ali.amount), 0) AS total
     FROM advance_list_items ali
     JOIN advance_lists al ON al.id = ali.list_id
     WHERE al.cycle_id = $1
       AND ali.employee_id = $2
       AND al.status <> 'cancelled'
       AND ali.status = 'active'
       AND ali.removed_at IS NULL
       AND ali.confirmed = TRUE
       ${excludeSql}`,
    params,
  );
  return toNumber(result.rows[0]?.total);
}

async function validateLimit(client, { list, employee, amount, excludingItemId, user, thresholdWarningConfirmed, overrideConfirmed }) {
  const accumulatedBefore = await accumulatedInCycle(client, list.cycle_id, employee.id, excludingItemId);
  const salary = Number(employee.current_salary);
  const userCanOverride = can(user, 'advances.override_limits', false);

  if (!Number.isFinite(salary) || salary <= 0) {
    const details = buildSalaryMissingDetails({ employee, amount, accumulatedBefore });
    if (userCanOverride && overrideConfirmed) {
      return {
        details,
        overrideUsed: true,
        thresholdWarningConfirmed: false,
        warningPercentage: null,
        maximumPercentage: null,
      };
    }
    throw httpError(userCanOverride ? 409 : 400, 'Funcionario sem salario cadastrado. Atualize a ficha do funcionario antes de calcular o limite.', {
      code: userCanOverride ? 'LIMIT_OVERRIDE_REQUIRED' : 'SALARY_MISSING',
      details,
    });
  }

  const details = buildLimitDetails({ employee, salary, accumulatedBefore, amount });
  const projected = details.projected_total;
  const warningLimit = details.warning_limit;
  const maximumLimit = details.maximum_limit;
  const exceedsWarning = projected > warningLimit;
  const exceedsCommonHardLimit = projected > maximumLimit;

  if (exceedsCommonHardLimit) {
    if (userCanOverride && overrideConfirmed) {
      return {
        details,
        overrideUsed: true,
        thresholdWarningConfirmed: true,
        warningPercentage: details.warning_percentage,
        maximumPercentage: details.maximum_percentage,
      };
    }
    throw httpError(409, userCanOverride
      ? 'Este valor ultrapassa o limite permitido para usuarios comuns.'
      : details.low_salary
        ? 'Este valor fara o funcionario ultrapassar o limite maximo de 40%.'
        : 'Este valor ultrapassa o limite maximo de 60% permitido.', {
      code: userCanOverride ? 'LIMIT_OVERRIDE_REQUIRED' : 'LIMIT_BLOCKED',
      details,
    });
  }

  if (!details.low_salary && exceedsWarning && !thresholdWarningConfirmed) {
    throw httpError(409, 'Este vale fara o funcionario ultrapassar 40% do salario.', {
      code: 'LIMIT_WARNING',
      details,
    });
  }

  return {
    details,
    overrideUsed: false,
    thresholdWarningConfirmed: !details.low_salary && exceedsWarning,
    warningPercentage: details.warning_percentage,
    maximumPercentage: details.maximum_percentage,
  };
}

function assertListEditable(list, user) {
  if (list.cycle_status !== 'open') throw httpError(400, 'Ciclo fechado nao permite alteracoes.');
  if (list.status === 'approved' || list.status === 'cancelled') throw httpError(400, 'Lista nao permite alteracoes neste status.');
  if (can(user, 'advances.review')) return;
  if (String(list.created_by) === String(user.id) && can(user, 'advances.edit_own_list')) return;
  if (String(list.created_by) === String(user.id) && can(user, 'advances.create')) return;
  throw httpError(403, 'Acesso nao autorizado.');
}

async function hydrateList(client, listId) {
  const listResult = await client.query(
    `SELECT al.*, ac.status AS cycle_status, ac.opened_at, ac.closed_at,
       creator.name AS created_by_name,
       approver.name AS approved_by_name,
       COALESCE(COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS employee_count,
       COALESCE(SUM(ali.amount) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::numeric AS total_amount
     FROM advance_lists al
     JOIN advance_cycles ac ON ac.id = al.cycle_id
     LEFT JOIN users creator ON creator.id = al.created_by
     LEFT JOIN users approver ON approver.id = al.approved_by
     LEFT JOIN advance_list_items ali ON ali.list_id = al.id
     WHERE al.id = $1
     GROUP BY al.id, ac.id, creator.name, approver.name`,
    [listId],
  );
  if (!listResult.rows[0]) throw httpError(404, 'Lista de vales nao encontrada.');
  const items = await client.query(
    `SELECT ali.*, e.full_name AS employee_name, e.current_salary, e.employment_status
     FROM advance_list_items ali
     JOIN employees e ON e.id = ali.employee_id
     WHERE ali.list_id = $1 AND ali.removed_at IS NULL AND ali.status = 'active'
     ORDER BY e.full_name`,
    [listId],
  );
  return {
    ...listResult.rows[0],
    status_label: listStatusLabels[listResult.rows[0].status] || listResult.rows[0].status,
    items: items.rows,
  };
}

export async function listAdvanceEmployees({ search = '' }) {
  return transaction(async (client) => {
    const term = `%${String(search || '').trim().toLowerCase()}%`;
    const result = await client.query(
      `SELECT id, full_name, current_salary, employment_status
       FROM employees
       WHERE deleted_at IS NULL
         AND employment_status <> 'desligado'
         AND ($1 = '%%' OR LOWER(full_name) LIKE $1 OR normalized_name ILIKE $1)
       ORDER BY full_name
       LIMIT 80`,
      [term],
    );
    return result.rows;
  });
}

export async function getAdvancesHome() {
  return transaction(async (client) => {
    const openCycle = await client.query(
      `SELECT ac.*,
        opener.name AS opened_by_name,
        COALESCE(COUNT(DISTINCT al.id), 0)::int AS list_count,
        COALESCE(COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS item_count,
        COALESCE(COUNT(DISTINCT ali.employee_id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS employee_count,
        COALESCE(SUM(ali.amount) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL AND al.status <> 'cancelled'), 0)::numeric AS total_amount
       FROM advance_cycles ac
       LEFT JOIN users opener ON opener.id = ac.opened_by
       LEFT JOIN advance_lists al ON al.cycle_id = ac.id
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       WHERE ac.status = 'open'
       GROUP BY ac.id, opener.name`,
    );
    const lists = await client.query(
      `SELECT al.*,
        ac.status AS cycle_status,
        creator.name AS created_by_name,
        COALESCE(COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS employee_count,
        COALESCE(SUM(ali.amount) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::numeric AS total_amount
       FROM advance_lists al
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       LEFT JOIN users creator ON creator.id = al.created_by
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       GROUP BY al.id, ac.id, creator.name
       ORDER BY al.list_date DESC, al.created_at DESC
       LIMIT 80`,
    );
    return {
      open_cycle: openCycle.rows[0] || null,
      lists: lists.rows.map((row) => ({ ...row, status_label: listStatusLabels[row.status] || row.status })),
    };
  });
}

export async function listCycles() {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT ac.*,
        opener.name AS opened_by_name,
        closer.name AS closed_by_name,
        COALESCE(COUNT(DISTINCT al.id), 0)::int AS list_count,
        COALESCE(COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS item_count,
        COALESCE(COUNT(DISTINCT ali.employee_id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS employee_count,
        COALESCE(SUM(ali.amount) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL AND al.status <> 'cancelled'), 0)::numeric AS total_amount
       FROM advance_cycles ac
       LEFT JOIN users opener ON opener.id = ac.opened_by
       LEFT JOIN users closer ON closer.id = ac.closed_by
       LEFT JOIN advance_lists al ON al.cycle_id = ac.id
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       GROUP BY ac.id, opener.name, closer.name
       ORDER BY ac.opened_at DESC`,
    );
    return result.rows;
  });
}

export async function createCycle(user) {
  assertCan(user, 'advances.cycles.create');
  return transaction(async (client) => {
    const existing = await client.query("SELECT id FROM advance_cycles WHERE status = 'open'");
    if (existing.rows[0]) throw httpError(409, 'Ja existe um ciclo de vales aberto.');
    const created = await client.query(
      `INSERT INTO advance_cycles (opened_by)
       VALUES ($1)
       RETURNING *`,
      [user.id],
    );
    await logAudit(client, {
      entityType: 'advance_cycle',
      entityId: created.rows[0].id,
      action: 'create',
      newValue: created.rows[0],
      userId: user.id,
    });
    return created.rows[0];
  });
}

export async function closeCycle(cycleId, body, user) {
  assertCan(user, 'advances.cycles.close');
  return transaction(async (client) => {
    const current = await client.query("SELECT * FROM advance_cycles WHERE id = $1 FOR UPDATE", [cycleId]);
    const cycle = current.rows[0];
    if (!cycle) throw httpError(404, 'Ciclo nao encontrado.');
    if (cycle.status !== 'open') throw httpError(400, 'Ciclo ja esta fechado.');
    const closed = await client.query(
      `UPDATE advance_cycles
       SET status = 'closed', closed_at = NOW(), closed_by = $1, notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [user.id, body.notes || null, cycleId],
    );
    await logAudit(client, {
      entityType: 'advance_cycle',
      entityId: cycleId,
      action: 'close',
      previousValue: cycle,
      newValue: closed.rows[0],
      userId: user.id,
    });

    let nextCycle = null;
    if (body.start_new) {
      const created = await client.query(
        `INSERT INTO advance_cycles (opened_by)
         VALUES ($1)
         RETURNING *`,
        [user.id],
      );
      nextCycle = created.rows[0];
      await logAudit(client, {
        entityType: 'advance_cycle',
        entityId: nextCycle.id,
        action: 'create',
        newValue: nextCycle,
        userId: user.id,
      });
    }

    return { closed_cycle: closed.rows[0], next_cycle: nextCycle };
  });
}

export async function createAdvanceList(body, user) {
  assertCan(user, 'advances.create');
  return transaction(async (client) => {
    const cycleResult = await client.query("SELECT * FROM advance_cycles WHERE status = 'open'");
    const cycle = cycleResult.rows[0];
    if (!cycle) throw httpError(400, 'Inicie um ciclo de vales antes de criar listas.');
    const created = await client.query(
      `INSERT INTO advance_lists (cycle_id, list_date, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING *`,
      [cycle.id, dateOrToday(body.list_date), user.id],
    );
    await logAudit(client, {
      entityType: 'advance_list',
      entityId: created.rows[0].id,
      action: 'create',
      newValue: created.rows[0],
      userId: user.id,
    });
    return hydrateList(client, created.rows[0].id);
  });
}

export async function updateAdvanceList(listId, body, user) {
  return transaction(async (client) => {
    const list = await fetchList(client, listId, true);
    assertListEditable(list, user);
    const updated = await client.query(
      `UPDATE advance_lists
       SET list_date = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [dateOrToday(body.list_date), user.id, listId],
    );
    await logAudit(client, {
      entityType: 'advance_list',
      entityId: listId,
      action: 'update',
      previousValue: { list_date: list.list_date },
      newValue: { list_date: updated.rows[0].list_date },
      userId: user.id,
    });
    return hydrateList(client, listId);
  });
}

export async function getAdvanceList(listId) {
  return transaction((client) => hydrateList(client, listId));
}

export async function saveAdvanceItem(listId, itemId, body, user) {
  return transaction(async (client) => {
    const list = await fetchList(client, listId, true);
    assertListEditable(list, user);
    await client.query('SELECT id FROM advance_cycles WHERE id = $1 FOR UPDATE', [list.cycle_id]);

    const amount = money(body.amount);
    let currentItem = null;
    if (itemId) {
      const itemResult = await client.query(
        `SELECT * FROM advance_list_items
         WHERE id = $1 AND list_id = $2 AND status = 'active' AND removed_at IS NULL
         FOR UPDATE`,
        [itemId, listId],
      );
      currentItem = itemResult.rows[0];
      if (!currentItem) throw httpError(404, 'Item da lista nao encontrado.');
    }

    const employeeId = body.employee_id || currentItem?.employee_id;
    if (!employeeId) throw httpError(400, 'Selecione um funcionario.');
    const employee = await fetchEmployeeForAdvance(client, employeeId, true);
    const validation = await validateLimit(client, {
      list,
      employee,
      amount,
      excludingItemId: itemId || null,
      user,
      thresholdWarningConfirmed: Boolean(body.threshold_warning_confirmed),
      overrideConfirmed: Boolean(body.override_confirmed),
    });

    const snapshot = validation.details;
    let saved;
    if (currentItem) {
      saved = await client.query(
        `UPDATE advance_list_items
         SET employee_id = $1,
             amount = $2,
             confirmed = TRUE,
             threshold_warning_confirmed = $3,
             override_used = $4,
             override_by = $5,
             salary_at_confirmation = $6,
             accumulated_before = $7,
             accumulated_after = $8,
             warning_percentage = $9,
             maximum_percentage = $10,
             projected_percentage = $11,
             updated_by = $12,
             updated_at = NOW()
         WHERE id = $13
         RETURNING *`,
        [
          employee.id,
          amount,
          validation.thresholdWarningConfirmed,
          validation.overrideUsed,
          validation.overrideUsed ? user.id : null,
          snapshot.salary,
          snapshot.accumulated_before,
          snapshot.projected_total,
          validation.warningPercentage,
          validation.maximumPercentage,
          snapshot.projected_percentage,
          user.id,
          itemId,
        ],
      );
      await logAudit(client, {
        entityType: 'advance_list',
        entityId: listId,
        action: 'item_update',
        previousValue: { item_id: itemId, employee_id: currentItem.employee_id, amount: currentItem.amount },
        newValue: { item_id: itemId, employee_id: employee.id, amount },
        userId: user.id,
      });
    } else {
      saved = await client.query(
        `INSERT INTO advance_list_items (
          list_id, employee_id, amount, confirmed, threshold_warning_confirmed, override_used, override_by,
          salary_at_confirmation, accumulated_before, accumulated_after, warning_percentage, maximum_percentage,
          projected_percentage, created_by, updated_by
        )
        VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
        RETURNING *`,
        [
          listId,
          employee.id,
          amount,
          validation.thresholdWarningConfirmed,
          validation.overrideUsed,
          validation.overrideUsed ? user.id : null,
          snapshot.salary,
          snapshot.accumulated_before,
          snapshot.projected_total,
          validation.warningPercentage,
          validation.maximumPercentage,
          snapshot.projected_percentage,
          user.id,
        ],
      );
      await logAudit(client, {
        entityType: 'advance_list',
        entityId: listId,
        action: 'item_add',
        newValue: { item_id: saved.rows[0].id, employee_id: employee.id, employee_name: employee.full_name, amount },
        userId: user.id,
      });
    }

    if (validation.thresholdWarningConfirmed) {
      await logAudit(client, {
        entityType: 'advance_list',
        entityId: listId,
        action: 'threshold_warning_confirmed',
        newValue: snapshot,
        userId: user.id,
      });
    }
    if (validation.overrideUsed) {
      await logAudit(client, {
        entityType: 'advance_list',
        entityId: listId,
        action: 'override_limits',
        newValue: snapshot,
        userId: user.id,
      });
    }
    await logAudit(client, {
      entityType: 'advance_list',
      entityId: listId,
      action: 'item_confirm',
      newValue: { item_id: saved.rows[0].id, employee_id: employee.id, amount },
      userId: user.id,
    });

    return hydrateList(client, listId);
  });
}

export async function removeAdvanceItem(listId, itemId, user) {
  return transaction(async (client) => {
    const list = await fetchList(client, listId, true);
    assertListEditable(list, user);
    const item = await client.query(
      `UPDATE advance_list_items
       SET status = 'removed', removed_at = NOW(), removed_by = $1, updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND list_id = $3 AND status = 'active' AND removed_at IS NULL
       RETURNING *`,
      [user.id, itemId, listId],
    );
    if (!item.rows[0]) throw httpError(404, 'Item da lista nao encontrado.');
    await logAudit(client, {
      entityType: 'advance_list',
      entityId: listId,
      action: 'item_remove',
      previousValue: item.rows[0],
      userId: user.id,
    });
    return hydrateList(client, listId);
  });
}

export async function submitAdvanceList(listId, user) {
  return transaction(async (client) => {
    const list = await fetchList(client, listId, true);
    assertListEditable(list, user);
    const count = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM advance_list_items
       WHERE list_id = $1 AND status = 'active' AND removed_at IS NULL AND confirmed = TRUE`,
      [listId],
    );
    if (!count.rows[0].total) throw httpError(400, 'Adicione e confirme ao menos um funcionario.');
    const updated = await client.query(
      `UPDATE advance_lists
       SET status = 'pending_approval', updated_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [user.id, listId],
    );
    await logAudit(client, {
      entityType: 'advance_list',
      entityId: listId,
      action: 'submit_for_approval',
      previousValue: { status: list.status },
      newValue: { status: updated.rows[0].status },
      userId: user.id,
    });
    return hydrateList(client, listId);
  });
}

async function assertApprovalConsistency(client, list, user, overrideConfirmed) {
  const duplicate = await client.query(
    `SELECT employee_id, COUNT(*)::int
     FROM advance_list_items
     WHERE list_id = $1 AND status = 'active' AND removed_at IS NULL
     GROUP BY employee_id
     HAVING COUNT(*) > 1`,
    [list.id],
  );
  if (duplicate.rows[0]) throw httpError(400, 'A lista possui funcionario duplicado.');

  const items = await client.query(
    `SELECT * FROM advance_list_items
     WHERE list_id = $1 AND status = 'active' AND removed_at IS NULL
     ORDER BY created_at`,
    [list.id],
  );
  if (!items.rows.length) throw httpError(400, 'A lista nao possui itens.');

  for (const item of items.rows) {
    if (!item.confirmed) throw httpError(400, 'Todos os itens precisam estar confirmados.');
    const employee = await fetchEmployeeForAdvance(client, item.employee_id, true);
    const validationUser = item.override_used
      ? { ...user, permissions: [...new Set([...(user.permissions || []), 'advances.override_limits'])] }
      : user;
    await validateLimit(client, {
      list,
      employee,
      amount: Number(item.amount),
      excludingItemId: item.id,
      user: validationUser,
      thresholdWarningConfirmed: item.threshold_warning_confirmed,
      overrideConfirmed: item.override_used || overrideConfirmed,
    });
  }
}

export async function approveAdvanceList(listId, body, user) {
  assertCan(user, 'advances.approve');
  return transaction(async (client) => {
    const list = await fetchList(client, listId, true);
    if (list.cycle_status !== 'open') throw httpError(400, 'Ciclo fechado nao permite aprovacao.');
    if (list.status !== 'pending_approval') throw httpError(400, 'Apenas listas aguardando aprovacao podem ser aprovadas.');
    await client.query('SELECT id FROM advance_cycles WHERE id = $1 FOR UPDATE', [list.cycle_id]);
    await assertApprovalConsistency(client, list, user, Boolean(body.override_confirmed));
    const updated = await client.query(
      `UPDATE advance_lists
       SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [user.id, listId],
    );
    await logAudit(client, {
      entityType: 'advance_list',
      entityId: listId,
      action: 'approve',
      previousValue: { status: list.status },
      newValue: { status: updated.rows[0].status, approved_by: user.id, approved_at: updated.rows[0].approved_at },
      userId: user.id,
    });
    return hydrateList(client, listId);
  });
}

export async function getAdvanceSummary(listId) {
  return transaction(async (client) => {
    const list = await hydrateList(client, listId);
    const items = [];
    for (const item of list.items) {
      const salary = Number(item.current_salary);
      const maximumPercentage = salary <= 1999.99 ? 40 : 60;
      const maximumLimit = Number.isFinite(salary) && salary > 0 ? salary * (maximumPercentage / 100) : null;
      const accumulated = await accumulatedInCycle(client, list.cycle_id, item.employee_id);
      items.push({
        ...item,
        salary,
        maximum_percentage: maximumPercentage,
        maximum_limit: maximumLimit,
        accumulated_current_cycle: accumulated,
        remaining: maximumLimit === null ? null : Math.max(0, maximumLimit - accumulated),
      });
    }
    return {
      ...list,
      items,
      total_amount: items.reduce((sum, item) => sum + Number(item.amount), 0),
    };
  });
}

export async function getEmployeeAdvanceProfile(employeeId) {
  return transaction(async (client) => {
    const employee = await fetchEmployeeForAdvance(client, employeeId, false, true);
    const cycleResult = await client.query("SELECT * FROM advance_cycles WHERE status = 'open'");
    const openCycle = cycleResult.rows[0] || null;
    const salary = Number(employee.current_salary);
    const maximumPercentage = Number.isFinite(salary) && salary > 0 ? (salary <= 1999.99 ? 40 : 60) : null;
    const warningLimit = Number.isFinite(salary) && salary > 0 ? salary * 0.4 : null;
    const maximumLimit = maximumPercentage ? salary * (maximumPercentage / 100) : null;
    const accumulated = openCycle ? await accumulatedInCycle(client, openCycle.id, employeeId) : 0;
    const history = await client.query(
      `SELECT al.id AS list_id, al.list_date, al.status AS list_status, ac.id AS cycle_id, ac.status AS cycle_status,
        ali.id AS item_id, ali.amount, ali.override_used, ali.threshold_warning_confirmed, ali.created_at
       FROM advance_list_items ali
       JOIN advance_lists al ON al.id = ali.list_id
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       WHERE ali.employee_id = $1
         AND ali.status = 'active'
         AND ali.removed_at IS NULL
       ORDER BY al.list_date DESC, ali.created_at DESC
       LIMIT 80`,
      [employeeId],
    );
    return {
      employee,
      open_cycle: openCycle,
      current_cycle: openCycle ? {
        accumulated,
        warning_limit: warningLimit,
        maximum_percentage: maximumPercentage,
        maximum_limit: maximumLimit,
        remaining: maximumLimit === null ? null : Math.max(0, maximumLimit - accumulated),
      } : null,
      history: history.rows,
    };
  });
}
