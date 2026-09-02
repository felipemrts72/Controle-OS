import { createHash } from 'node:crypto';
import { transaction } from '../database/pool.js';
import { logAudit } from './auditService.js';
import { hasPermission, isSuperAdmin } from './permissionService.js';
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

function isAdvanceAdmin(user) {
  return isSuperAdmin(user);
}

function assertSpecificAdvancePermission(user, permission, message) {
  if (isAdvanceAdmin(user)) return;
  if (hasPermission(user, permission)) return;
  throw httpError(403, message || 'Acesso nao autorizado.');
}

function money(value, field = 'valor') {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw httpError(400, `Informe um ${field} valido.`);
  return Math.round(number * 100) / 100;
}

function localDateFromDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateOrToday(value) {
  if (!value) return localDateFromDate();
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, 'Data da lista invalida.');
  return text;
}

function assertValidCivilDate(value, message = 'Data invalida.') {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, message);
  const [year, month, day] = text.split('-').map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    throw httpError(400, message);
  }
  return text;
}

function toNumber(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function fromCents(value) {
  return Math.round(Number(value)) / 100;
}

function splitInstallments(totalAmount, count) {
  const totalCents = toCents(totalAmount);
  const base = Math.floor(totalCents / count);
  const values = Array.from({ length: count }, () => base);
  values[count - 1] += totalCents - (base * count);
  return values.map(fromCents);
}

function percentageClass(value) {
  if (!Number.isFinite(value)) return 'normal';
  if (value >= 60) return 'danger';
  if (value >= 40) return 'warning';
  return 'normal';
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
    `SELECT al.*, al.xmin::text AS row_version, ac.status AS cycle_status, ac.opened_at, ac.closed_at
     FROM advance_lists al
     JOIN advance_cycles ac ON ac.id = al.cycle_id
     WHERE al.id = $1 AND al.deleted_at IS NULL
     ${lock ? 'FOR UPDATE OF al' : ''}`,
    [listId],
  );
  if (!result.rows[0]) throw httpError(404, 'Lista de vales nao encontrada.');
  return result.rows[0];
}

async function fetchEmployeeForAdvance(client, employeeId, lock = false, allowTerminated = false) {
  const result = await client.query(
    `SELECT e.id, e.full_name, e.job_title, e.sector_id, s.name AS sector_name, e.current_salary, e.employment_status
     FROM employees e
     LEFT JOIN sectors s ON s.id = e.sector_id
     WHERE e.id = $1 AND e.deleted_at IS NULL
     ${lock ? 'FOR UPDATE OF e' : ''}`,
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
       AND al.deleted_at IS NULL
       AND ali.status = 'active'
       AND ali.removed_at IS NULL
       AND ali.confirmed = TRUE
       ${excludeSql}`,
    params,
  );
  return toNumber(result.rows[0]?.total);
}

async function fetchOpenCycle(client) {
  const result = await client.query("SELECT * FROM advance_cycles WHERE status = 'open'");
  return result.rows[0] || null;
}

function buildCycleLimitResult(employee, accumulated) {
  const salary = Number(employee.current_salary);
  const hasSalary = Number.isFinite(salary) && salary > 0;
  const maximumPercentage = hasSalary ? (salary <= 1999.99 ? 40 : 60) : null;
  const maximumLimit = hasSalary ? salary * (maximumPercentage / 100) : null;
  const used = Number(accumulated) || 0;
  const remaining = maximumLimit === null ? 0 : Math.max(0, maximumLimit - used);
  const usedPercentage = hasSalary ? (used / salary) * 100 : null;

  return {
    employee_id: employee.id,
    employee_name: employee.full_name,
    current_salary: hasSalary ? salary : null,
    maximum_percentage: maximumPercentage,
    maximum_limit: maximumLimit,
    used_amount: used,
    remaining,
    used_percentage: usedPercentage,
    exceeded: maximumLimit !== null && used > maximumLimit,
    status_level: percentageClass(usedPercentage),
  };
}

// All advance writers take this lock before any row lock. This also serializes
// individual advances, installments and cycle closure with list approval.
function advanceWriteTransaction(callback) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('advances:write'))");
    return callback(client);
  });
}

function classifyListLimit(employee, accumulatedBefore, amount) {
  const salary = Number(employee.current_salary);
  const details = Number.isFinite(salary) && salary > 0
    ? buildLimitDetails({ employee, salary, accumulatedBefore, amount })
    : buildSalaryMissingDetails({ employee, amount, accumulatedBefore });
  const rule = !details.salary ? 'SALARY_MISSING'
    : details.projected_total > details.maximum_limit ? 'MAXIMUM_EXCEEDED'
      : !details.low_salary && details.projected_total > details.warning_limit ? 'WARNING_EXCEEDED' : 'WITHIN_LIMIT';
  const classification = rule === 'WITHIN_LIMIT' ? 'OK'
    : rule === 'WARNING_EXCEEDED' ? 'WARNING' : 'OVERRIDE_REQUIRED';
  return { ...details, rule, classification };
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
     WHERE al.id = $1 AND al.deleted_at IS NULL
     GROUP BY al.id, ac.id, creator.name, approver.name`,
    [listId],
  );
  if (!listResult.rows[0]) throw httpError(404, 'Lista de vales nao encontrada.');
  const items = await client.query(
    `SELECT ali.*, e.full_name AS employee_name, e.job_title, e.sector_id, s.name AS sector_name,
       e.pix_key, e.current_salary, e.employment_status
     FROM advance_list_items ali
     JOIN employees e ON e.id = ali.employee_id
     LEFT JOIN sectors s ON s.id = e.sector_id
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
       LEFT JOIN advance_lists al ON al.cycle_id = ac.id AND al.deleted_at IS NULL
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       WHERE ac.status = 'open'
       GROUP BY ac.id, opener.name`,
    );
    const lists = await client.query(
      `SELECT al.*,
        ac.status AS cycle_status,
        creator.name AS created_by_name,
        COALESCE(COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS employee_count,
        COALESCE(SUM(ali.amount) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::numeric AS total_amount,
        CASE
          WHEN COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL) = 1
            AND BOOL_AND(COALESCE(ali.entry_type, 'list') = 'individual') FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL)
          THEN 'individual'
          WHEN COUNT(ali.id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL) = 1
            AND BOOL_AND(COALESCE(ali.entry_type, 'list') = 'installment') FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL)
          THEN 'installment'
          ELSE 'list'
        END AS card_type,
        MIN(e.full_name) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL) AS single_employee_name
       FROM advance_lists al
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       LEFT JOIN users creator ON creator.id = al.created_by
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       LEFT JOIN employees e ON e.id = ali.employee_id
       WHERE al.deleted_at IS NULL
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
       LEFT JOIN advance_lists al ON al.cycle_id = ac.id AND al.deleted_at IS NULL
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       GROUP BY ac.id, opener.name, closer.name
       ORDER BY ac.opened_at DESC`,
    );
    return result.rows;
  });
}

export async function createCycle(user) {
  assertCan(user, 'advances.cycles.create');
  return advanceWriteTransaction(async (client) => {
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
    await postPendingInstallmentsForCycle(client, created.rows[0], user);
    return created.rows[0];
  });
}

export async function closeCycle(cycleId, body, user) {
  assertSpecificAdvancePermission(user, 'advances.cycles.close', 'Você não possui permissão para fechar ciclos de vales.');
  return advanceWriteTransaction(async (client) => {
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
      await postPendingInstallmentsForCycle(client, nextCycle, user);
    }

    return { closed_cycle: closed.rows[0], next_cycle: nextCycle };
  });
}

export async function createAdvanceList(body, user) {
  assertCan(user, 'advances.create');
  return advanceWriteTransaction(async (client) => {
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
  return advanceWriteTransaction(async (client) => {
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
  return advanceWriteTransaction(async (client) => {
    const list = await fetchList(client, listId, true);
    assertListEditable(list, user);
    const amount = money(body.amount);
    let currentItem = null;
    if (itemId) {
      const result = await client.query(
        "SELECT * FROM advance_list_items WHERE id = $1 AND list_id = $2 AND status = 'active' AND removed_at IS NULL FOR UPDATE",
        [itemId, listId],
      );
      currentItem = result.rows[0];
      if (!currentItem) throw httpError(404, 'Item da lista nao encontrado.');
    }
    const employeeId = body.employee_id || currentItem?.employee_id;
    if (!employeeId) throw httpError(400, 'Selecione um funcionario.');
    const employee = await fetchEmployeeForAdvance(client, employeeId, true);
    // Confirmed means the line was entered, not that a limit was authorized.
    // Never accept authorization flags on draft writes.
    const saved = currentItem ? await client.query(
      `UPDATE advance_list_items SET employee_id = $1, amount = $2, confirmed = TRUE,
        threshold_warning_confirmed = FALSE, override_used = FALSE, override_by = NULL,
        salary_at_confirmation = NULL, accumulated_before = NULL, accumulated_after = NULL,
        warning_percentage = NULL, maximum_percentage = NULL, projected_percentage = NULL,
        limit_review_rejected_at = NULL, limit_review_rejected_by = NULL,
        updated_by = $3, updated_at = clock_timestamp() WHERE id = $4 RETURNING *`,
      [employee.id, amount, user.id, itemId],
    ) : await client.query(
      `INSERT INTO advance_list_items (list_id, employee_id, amount, confirmed, created_by, updated_by)
       VALUES ($1, $2, $3, TRUE, $4, $4) RETURNING *`,
      [listId, employee.id, amount, user.id],
    );
    await logAudit(client, {
      entityType: 'advance_list', entityId: listId, action: currentItem ? 'item_update' : 'item_add',
      previousValue: currentItem,
      newValue: { item_id: saved.rows[0].id, employee_id: employee.id, amount }, userId: user.id,
    });
    return hydrateList(client, listId);
  });
}

export async function removeAdvanceItem(listId, itemId, user) {
  return advanceWriteTransaction(async (client) => {
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

export async function deleteAdvanceList(listId, user) {
  assertSpecificAdvancePermission(user, 'advances.lists.delete', 'Você não possui permissão para excluir listas de vales.');
  return advanceWriteTransaction(async (client) => {
    const list = await fetchList(client, listId, true);
    await client.query('SELECT id FROM advance_cycles WHERE id = $1 FOR UPDATE', [list.cycle_id]);
    const admin = isAdvanceAdmin(user);

    if (!admin && list.cycle_status !== 'open') {
      throw httpError(400, 'Nao e possivel excluir lista de ciclo fechado.');
    }
    if (!admin && list.status !== 'draft') {
      throw httpError(400, 'Apenas listas em edicao podem ser excluidas.');
    }

    const linkedInstallments = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM advance_installments ai
       JOIN advance_list_items ali ON ali.id = ai.posted_advance_item_id
       WHERE ali.list_id = $1
         AND ai.status <> 'cancelled'`,
      [listId],
    );
    if (!admin && linkedInstallments.rows[0].total > 0) {
      throw httpError(400, 'Esta lista possui parcelas vinculadas e nao pode ser excluida.');
    }

    const blockedEntries = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM advance_list_items
       WHERE list_id = $1
         AND status = 'active'
         AND removed_at IS NULL
         AND COALESCE(entry_type, 'list') <> 'list'`,
      [listId],
    );
    if (!admin && blockedEntries.rows[0].total > 0) {
      throw httpError(400, 'Esta lista possui lancamentos individuais ou parcelas e nao pode ser excluida.');
    }

    const itemSummary = await client.query(
      `SELECT COUNT(*)::int AS item_count,
        COALESCE(COUNT(DISTINCT employee_id), 0)::int AS employee_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'active' AND removed_at IS NULL), 0)::numeric AS total_amount,
        COALESCE(COUNT(*) FILTER (WHERE COALESCE(entry_type, 'list') <> 'list' AND status = 'active' AND removed_at IS NULL), 0)::int AS special_entries
       FROM advance_list_items
       WHERE list_id = $1`,
      [listId],
    );

    const items = await client.query(
      `UPDATE advance_list_items
       SET status = 'removed',
           removed_at = NOW(),
           removed_by = $1,
           updated_by = $1,
           updated_at = NOW()
       WHERE list_id = $2
         AND status = 'active'
         AND removed_at IS NULL
       RETURNING id, employee_id, amount`,
      [user.id, listId],
    );

    const deleted = await client.query(
      `UPDATE advance_lists
       SET status = 'cancelled',
           deleted_at = NOW(),
           deleted_by = $1,
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2
         AND deleted_at IS NULL
       RETURNING *`,
      [user.id, listId],
    );
    if (!deleted.rows[0]) throw httpError(404, 'Lista de vales nao encontrada.');

    await logAudit(client, {
      entityType: 'advance_list',
      entityId: listId,
      action: 'soft_delete',
      previousValue: {
        list_id: listId,
        status: list.status,
        cycle_id: list.cycle_id,
        cycle_status: list.cycle_status,
        list_date: list.list_date,
        total_amount: itemSummary.rows[0].total_amount,
        item_count: itemSummary.rows[0].item_count,
        employee_count: itemSummary.rows[0].employee_count,
        linked_installments: linkedInstallments.rows[0].total,
        special_entries: itemSummary.rows[0].special_entries,
        items: items.rows,
      },
      newValue: {
        status: deleted.rows[0].status,
        deleted_at: deleted.rows[0].deleted_at,
        deleted_by: user.id,
        admin_override: admin,
      },
      userId: user.id,
    });

    return { ok: true, id: listId };
  });
}

export async function submitAdvanceList(listId, user) {
  return advanceWriteTransaction(async (client) => {
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

async function buildListReview(client, list, user) {
  // Deterministic lock order protects current salaries against concurrent edits.
  await client.query(
    `SELECT e.id FROM employees e WHERE e.id IN (
      SELECT employee_id FROM advance_list_items WHERE list_id = $1 AND status = 'active' AND removed_at IS NULL
    ) ORDER BY e.id FOR UPDATE`, [list.id],
  );
  const result = await client.query(
    `SELECT ali.*, ali.xmin::text AS row_version, e.xmin::text AS employee_version,
       e.full_name, e.current_salary, e.employment_status, e.deleted_at AS employee_deleted_at,
       COALESCE(t.total, 0) - CASE WHEN ali.confirmed THEN ali.amount ELSE 0 END AS cycle_accumulated
     FROM advance_list_items ali
     JOIN employees e ON e.id = ali.employee_id
     LEFT JOIN (
       SELECT other.employee_id, SUM(other.amount) AS total
       FROM advance_list_items other JOIN advance_lists al ON al.id = other.list_id
       WHERE al.cycle_id = $2 AND al.status <> 'cancelled' AND al.deleted_at IS NULL
         AND other.status = 'active' AND other.removed_at IS NULL AND other.confirmed = TRUE
       GROUP BY other.employee_id
     ) t ON t.employee_id = ali.employee_id
     WHERE ali.list_id = $1 AND ali.status = 'active' AND ali.removed_at IS NULL
     ORDER BY ali.employee_id, ali.id`, [list.id, list.cycle_id],
  );
  if (!result.rows.length) throw httpError(400, 'A lista nao possui itens.');
  const employeeIds = new Set();
  const items = result.rows.map((item) => {
    if (employeeIds.has(item.employee_id)) throw httpError(400, 'A lista possui funcionario duplicado.');
    employeeIds.add(item.employee_id);
    if (!item.confirmed) throw httpError(400, 'Todos os itens precisam estar confirmados.');
    if (item.employee_deleted_at || item.employment_status === 'desligado') {
      throw httpError(400, 'Funcionario removido ou desligado nao pode receber vale. Edite a lista.');
    }
    const details = classifyListLimit({ id: item.employee_id, full_name: item.full_name, current_salary: item.current_salary },
      Number(item.cycle_accumulated), Number(item.amount));
    return { ...details, line_id: item.id, row_version: item.row_version,
      employee_version: item.employee_version, updated_at: item.updated_at,
      rejected_at: item.limit_review_rejected_at,
      can_authorize: details.classification !== 'OVERRIDE_REQUIRED' || can(user, 'advances.override_limits', false) };
  });
  const reviewToken = createHash('sha256').update(JSON.stringify({
    list_id: list.id, cycle_id: list.cycle_id, list_date: list.list_date,
    status: list.status, updated_at: list.updated_at, version: list.row_version, items,
  })).digest('hex');
  return { items, review_token: reviewToken, review_items: items.filter((item) => item.classification !== 'OK') };
}

export async function approveAdvanceList(listId, body = {}, user) {
  assertSpecificAdvancePermission(user, 'advances.approve', 'Você não possui permissão para aprovar listas de vales.');
  return advanceWriteTransaction(async (client) => {
    const list = await fetchList(client, listId, true);
    if (list.status === 'approved') throw httpError(409, 'Esta lista ja foi aprovada. Atualize a pagina.', { code: 'LIST_ALREADY_APPROVED' });
    if (list.cycle_status !== 'open') throw httpError(400, 'Ciclo fechado nao permite aprovacao.');
    if (list.status !== 'pending_approval') throw httpError(400, 'Apenas listas aguardando aprovacao podem ser aprovadas.');
    const review = await buildListReview(client, list, user);
    const requiresEdit = async () => ({ requires_review: false, requires_edit: true,
      message: 'Autorização negada. Edite ou remova explicitamente as linhas rejeitadas antes de aprovar. Nenhuma autorização foi salva.',
      list: await hydrateList(client, listId) });
    if (review.items.some((item) => item.rejected_at)) return requiresEdit();
    const hasSubmission = body.review_token !== undefined || body.decisions !== undefined;
    const stale = hasSubmission && body.review_token !== review.review_token;
    const reviewResponse = () => ({ requires_review: true, requires_edit: false,
      code: stale ? 'LIST_REVIEW_STALE' : 'LIST_REVIEW_REQUIRED',
      message: stale ? 'Os dados mudaram. Revise os valores atualizados e escolha novamente.' : 'Revise os limites antes de aprovar a lista.',
      review_token: review.review_token, review_items: review.review_items });
    // Even if a change removes every warning, an old confirmation cannot approve it.
    if (stale || (!hasSubmission && review.review_items.length)) return reviewResponse();
    if (hasSubmission) {
      if (!Array.isArray(body.decisions)) throw httpError(400, 'Envie todas as decisões da revisão.');
      const decisions = new Map();
      const required = new Map(review.review_items.map((item) => [item.line_id, item]));
      for (const decision of body.decisions) {
        if (!decision || !required.has(decision.line_id) || decisions.has(decision.line_id)
          || !['approve', 'reject'].includes(decision.decision)) throw httpError(400, 'Decisões inválidas ou duplicadas.');
        if (decision.decision === 'approve' && !required.get(decision.line_id).can_authorize) {
          throw httpError(403, 'Você não possui permissão para autorizar override de limites.');
        }
        decisions.set(decision.line_id, decision.decision);
      }
      if (decisions.size !== required.size) throw httpError(400, 'Decida todas as pendências antes de confirmar.');
      const rejected = review.review_items.filter((item) => decisions.get(item.line_id) === 'reject');
      if (rejected.length) {
        for (const item of rejected) {
          await client.query(`UPDATE advance_list_items SET limit_review_rejected_at = clock_timestamp(),
            limit_review_rejected_by = $1, updated_by = $1, updated_at = clock_timestamp() WHERE id = $2`, [user.id, item.line_id]);
          await logAudit(client, { entityType: 'advance_list', entityId: listId, action: 'limit_authorization_rejected',
            newValue: { ...item, list_id: listId, decision: 'reject' }, userId: user.id });
        }
        return requiresEdit();
      }
    }
    for (const item of review.items) {
      const override = item.classification === 'OVERRIDE_REQUIRED';
      const warning = item.classification === 'WARNING';
      await client.query(
        `UPDATE advance_list_items SET threshold_warning_confirmed = $1, override_used = $2, override_by = $3,
          salary_at_confirmation = $4, accumulated_before = $5, accumulated_after = $6,
          warning_percentage = $7, maximum_percentage = $8, projected_percentage = $9,
          updated_by = $10, updated_at = clock_timestamp() WHERE id = $11`,
        [warning || (override && Boolean(item.salary)), override, override ? user.id : null,
          item.salary, item.accumulated_before, item.projected_total, item.warning_percentage ?? null,
          item.maximum_percentage ?? null, item.projected_percentage ?? null, user.id, item.line_id],
      );
      if (warning || override) await logAudit(client, {
        entityType: 'advance_list', entityId: listId, action: override ? 'override_limits' : 'threshold_warning_confirmed',
        newValue: { ...item, list_id: listId, decision: 'approve', review_token: review.review_token }, userId: user.id,
      });
    }
    const updated = await client.query(
      `UPDATE advance_lists SET status = 'approved', approved_by = $1, approved_at = NOW(),
       updated_by = $1, updated_at = clock_timestamp() WHERE id = $2 RETURNING *`, [user.id, listId],
    );
    await logAudit(client, {
      entityType: 'advance_list', entityId: listId, action: 'approve', previousValue: { status: list.status },
      newValue: { status: updated.rows[0].status, approved_by: user.id, approved_at: updated.rows[0].approved_at }, userId: user.id,
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
         AND al.deleted_at IS NULL
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

export async function lookupAdvanceLimits({ search = '' }) {
  return transaction(async (client) => {
    const term = String(search || '').trim();
    if (term.length < 3) return { open_cycle: null, results: [] };

    const openCycle = await fetchOpenCycle(client);
    if (!openCycle) return { open_cycle: null, results: [] };

    const result = await client.query(
      `SELECT id, full_name, current_salary, employment_status
       FROM employees
       WHERE deleted_at IS NULL
         AND employment_status <> 'desligado'
         AND (LOWER(full_name) LIKE LOWER($1) OR normalized_name ILIKE $1)
       ORDER BY full_name
       LIMIT 30`,
      [`%${term}%`],
    );

    const results = [];
    for (const employee of result.rows) {
      const accumulated = await accumulatedInCycle(client, openCycle.id, employee.id);
      results.push(buildCycleLimitResult(employee, accumulated));
    }

    return { open_cycle: openCycle, results };
  });
}

function parseReceiptAt(value) {
  if (!value) throw httpError(400, 'Informe a data/hora do comprovante.');
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw httpError(400, 'Data/hora do comprovante invalida.');
  const dateOnly = assertValidCivilDate(match[1], 'Data/hora do comprovante invalida.');
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] || '0');
  if (hour > 23 || minute > 59 || second > 59) throw httpError(400, 'Data/hora do comprovante invalida.');
  return {
    dateOnly,
    timestamp: `${dateOnly} ${match[2]}:${match[3]}:${String(second).padStart(2, '0')}`,
  };
}

async function findOrCreateIndividualList(client, cycle, user, listDate) {
  const created = await client.query(
    `INSERT INTO advance_lists (cycle_id, list_date, status, created_by, updated_by, approved_by, approved_at)
     VALUES ($1, $2, 'approved', $3, $3, $3, NOW())
     RETURNING *`,
    [cycle.id, listDate, user.id],
  );
  await logAudit(client, {
    entityType: 'advance_list',
    entityId: created.rows[0].id,
    action: 'individual_list_create',
    newValue: { cycle_id: cycle.id, list_date: listDate },
    userId: user.id,
  });
  return created.rows[0];
}

function validateInstallmentsCount(value, { min = 1 } = {}) {
  const count = Number(value || 1);
  if (!Number.isInteger(count) || count < min || count > 10) {
    throw httpError(400, `Informe uma quantidade de parcelas entre ${min} e 10.`);
  }
  return count;
}

function buildAdvanceSnapshot(employee, accumulatedBefore, amount) {
  const salary = Number(employee.current_salary);
  const hasSalary = Number.isFinite(salary) && salary > 0;
  const maximumPercentage = hasSalary ? (salary <= 1999.99 ? 40 : 60) : null;
  const maximumLimit = hasSalary ? salary * (maximumPercentage / 100) : null;
  const projectedTotal = accumulatedBefore + amount;
  const projectedPercentage = hasSalary ? (projectedTotal / salary) * 100 : null;
  return {
    salary: hasSalary ? salary : null,
    maximumPercentage,
    maximumLimit,
    projectedTotal,
    projectedPercentage,
    remaining: maximumLimit === null ? 0 : Math.max(0, maximumLimit - projectedTotal),
    exceeded: maximumLimit !== null && projectedTotal > maximumLimit,
  };
}

async function insertAdvanceItem(client, { cycle, employee, amount, receiptAt, receiptDate, sourceBank, entryType, user, excludingItemId = null, list = null }) {
  const accumulatedBefore = await accumulatedInCycle(client, cycle.id, employee.id, excludingItemId);
  const snapshot = buildAdvanceSnapshot(employee, accumulatedBefore, amount);
  const targetList = list || await findOrCreateIndividualList(client, cycle, user, receiptDate || localDateFromDate());
  const saved = await client.query(
    `INSERT INTO advance_list_items (
      list_id, employee_id, amount, status, confirmed, threshold_warning_confirmed, override_used, override_by,
      salary_at_confirmation, accumulated_before, accumulated_after, warning_percentage, maximum_percentage,
      projected_percentage, receipt_at, source_bank, entry_type, created_by, updated_by
    )
    VALUES ($1, $2, $3, 'active', TRUE, $4, $5, $6, $7, $8, $9, 40, $10, $11, $12, $13, $14, $15, $15)
    RETURNING *`,
    [
      targetList.id,
      employee.id,
      amount,
      snapshot.projectedPercentage !== null && snapshot.projectedPercentage >= 40,
      snapshot.exceeded,
      snapshot.exceeded ? user.id : null,
      snapshot.salary,
      accumulatedBefore,
      snapshot.projectedTotal,
      snapshot.maximumPercentage,
      snapshot.projectedPercentage,
      receiptAt,
      sourceBank || null,
      entryType,
      user.id,
    ],
  );
  return { item: saved.rows[0], list: targetList, snapshot };
}

async function createInstallmentRows(client, planId, amounts) {
  for (let index = 0; index < amounts.length; index += 1) {
    await client.query(
      `INSERT INTO advance_installments (plan_id, installment_number, installment_amount)
       VALUES ($1, $2, $3)`,
      [planId, index + 1, amounts[index]],
    );
  }
}

async function postInstallment(client, { cycle, installment, employee, user, receiptAt = null, receiptDate = null, sourceBank = null, reuseItemId = null }) {
  let item;
  let snapshot;
  let list = null;
  if (reuseItemId) {
    const current = await client.query(
      `SELECT ali.*, al.cycle_id, al.status AS list_status
       FROM advance_list_items ali
       JOIN advance_lists al ON al.id = ali.list_id
       WHERE ali.id = $1 AND ali.employee_id = $2 AND al.cycle_id = $3 AND al.deleted_at IS NULL FOR UPDATE`,
      [reuseItemId, employee.id, cycle.id],
    );
    item = current.rows[0];
    if (!item) throw httpError(404, 'Vale individual nao encontrado para conversao.');
    const accumulatedBefore = await accumulatedInCycle(client, cycle.id, employee.id, reuseItemId);
    snapshot = buildAdvanceSnapshot(employee, accumulatedBefore, Number(installment.installment_amount));
    const updated = await client.query(
      `UPDATE advance_list_items
       SET amount = $1,
           entry_type = 'installment',
           salary_at_confirmation = $2,
           accumulated_before = $3,
           accumulated_after = $4,
           threshold_warning_confirmed = $5,
           override_used = $6,
           override_by = $7,
           maximum_percentage = $8,
           projected_percentage = $9,
           updated_by = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        installment.installment_amount,
        snapshot.salary,
        accumulatedBefore,
        snapshot.projectedTotal,
        snapshot.projectedPercentage !== null && snapshot.projectedPercentage >= 40,
        snapshot.exceeded,
        snapshot.exceeded ? user.id : null,
        snapshot.maximumPercentage,
        snapshot.projectedPercentage,
        user.id,
        reuseItemId,
      ],
    );
    item = updated.rows[0];
  } else {
    const effectiveReceiptAt = receiptAt || `${localDateFromDate()} 00:00:00`;
    const effectiveReceiptDate = receiptDate || dateOrToday(effectiveReceiptAt);
    const inserted = await insertAdvanceItem(client, {
      cycle,
      employee,
      amount: Number(installment.installment_amount),
      receiptAt: effectiveReceiptAt,
      receiptDate: effectiveReceiptDate,
      sourceBank,
      entryType: 'installment',
      user,
    });
    item = inserted.item;
    list = inserted.list;
    snapshot = inserted.snapshot;
  }

  await client.query(
    `UPDATE advance_installments
     SET status = 'posted',
         cycle_id = $1,
         posted_advance_item_id = $2,
         posted_at = NOW(),
         posted_by = $3,
         updated_at = NOW()
     WHERE id = $4 AND status = 'pending'
     RETURNING *`,
    [cycle.id, item.id, user.id, installment.id],
  );

  return { item, list, snapshot };
}

async function createInstallmentPlan(client, { employee, originalItemId = null, originalAmount, installmentsCount, user }) {
  const amounts = splitInstallments(originalAmount, installmentsCount);
  const planResult = await client.query(
    `INSERT INTO advance_installment_plans (
      employee_id, original_individual_advance_id, original_amount, installments_count, status, created_by
    )
    VALUES ($1, $2, $3, $4, 'active', $5)
    RETURNING *`,
    [employee.id, originalItemId, originalAmount, installmentsCount, user.id],
  );
  await createInstallmentRows(client, planResult.rows[0].id, amounts);
  const installments = await client.query(
    `SELECT * FROM advance_installments WHERE plan_id = $1 ORDER BY installment_number`,
    [planResult.rows[0].id],
  );
  return { plan: planResult.rows[0], installments: installments.rows, amounts };
}

async function finalizeInstallmentPlanIfNeeded(client, planId, user) {
  const pending = await client.query(
    `SELECT COUNT(*)::int AS pending_count
     FROM advance_installments
     WHERE plan_id = $1 AND status = 'pending'`,
    [planId],
  );
  if (pending.rows[0].pending_count === 0) {
    const updated = await client.query(
      `UPDATE advance_installment_plans
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [planId],
    );
    if (updated.rows[0]) {
      await logAudit(client, {
        entityType: 'advance_installment_plan',
        entityId: planId,
        action: 'installment_plan_complete',
        newValue: updated.rows[0],
        userId: user.id,
      });
    }
  }
}

async function postPendingInstallmentsForCycle(client, cycle, user) {
  const plans = await client.query(
    `SELECT aip.*, e.full_name, e.current_salary, e.employment_status
     FROM advance_installment_plans aip
     JOIN employees e ON e.id = aip.employee_id
     WHERE aip.status = 'active'
       AND e.deleted_at IS NULL
     ORDER BY aip.created_at`,
  );

  for (const plan of plans.rows) {
    const alreadyPosted = await client.query(
      `SELECT id FROM advance_installments
       WHERE plan_id = $1 AND cycle_id = $2 AND status = 'posted'
       LIMIT 1`,
      [plan.id, cycle.id],
    );
    if (alreadyPosted.rows[0]) continue;

    const next = await client.query(
      `SELECT * FROM advance_installments
       WHERE plan_id = $1 AND status = 'pending'
       ORDER BY installment_number
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [plan.id],
    );
    const installment = next.rows[0];
    if (!installment) {
      await finalizeInstallmentPlanIfNeeded(client, plan.id, user);
      continue;
    }

    const todayDate = localDateFromDate();
    const posted = await postInstallment(client, {
      cycle,
      installment,
      employee: {
        id: plan.employee_id,
        full_name: plan.full_name,
        current_salary: plan.current_salary,
        employment_status: plan.employment_status,
      },
      user,
      receiptAt: `${todayDate} 00:00:00`,
      receiptDate: todayDate,
      sourceBank: null,
    });
    await logAudit(client, {
      entityType: 'advance_installment_plan',
      entityId: plan.id,
      action: 'installment_post_auto',
      newValue: {
        installment_id: installment.id,
        installment_number: installment.installment_number,
        cycle_id: cycle.id,
        item_id: posted.item.id,
        amount: installment.installment_amount,
      },
      userId: user.id,
    });
    await finalizeInstallmentPlanIfNeeded(client, plan.id, user);
  }
}

export async function createIndividualAdvance(body, user) {
  assertCan(user, 'advances.create_individual');
  return advanceWriteTransaction(async (client) => {
    const openCycle = await fetchOpenCycle(client);
    if (!openCycle) throw httpError(400, 'Inicie um ciclo de vales antes de lançar vale individual.');

    const employeeId = body.employee_id;
    if (!employeeId) throw httpError(400, 'Selecione um funcionario.');
    const employee = await fetchEmployeeForAdvance(client, employeeId, true);
    const amount = money(body.amount);
    const receipt = parseReceiptAt(body.receipt_at);
    const sourceBank = String(body.source_bank || '').trim();
    if (sourceBank && !['Sicoob', 'Sicredi', 'Asaas', 'Itaú', 'ItaÃº'].includes(sourceBank)) throw httpError(400, 'Banco de origem invalido.');
    const installmentsCount = validateInstallmentsCount(body.installments_count || 1);

    let saved;
    let list;
    let snapshot;
    let installmentInfo = null;
    if (installmentsCount > 1) {
      assertSpecificAdvancePermission(user, 'advances.installments.create', 'Você não possui permissão para criar parcelamentos de vales.');
      const planData = await createInstallmentPlan(client, {
        employee,
        originalAmount: amount,
        installmentsCount,
        user,
      });
      const firstInstallment = planData.installments[0];
      const posted = await postInstallment(client, {
        cycle: openCycle,
        installment: firstInstallment,
        employee,
        user,
        receiptAt: receipt.timestamp,
        receiptDate: receipt.dateOnly,
        sourceBank,
      });
      saved = { rows: [posted.item] };
      list = posted.list;
      snapshot = posted.snapshot;
      await finalizeInstallmentPlanIfNeeded(client, planData.plan.id, user);
      installmentInfo = {
        plan_id: planData.plan.id,
        original_amount: amount,
        installments_count: installmentsCount,
        current_installment_number: 1,
        current_installment_amount: Number(firstInstallment.installment_amount),
        remaining_installments: installmentsCount - 1,
        amounts: planData.amounts,
      };
      await logAudit(client, {
        entityType: 'advance_installment_plan',
        entityId: planData.plan.id,
        action: 'installment_plan_create',
        newValue: installmentInfo,
        userId: user.id,
      });
    } else {
      const inserted = await insertAdvanceItem(client, {
        cycle: openCycle,
        employee,
        amount,
        receiptAt: receipt.timestamp,
        receiptDate: receipt.dateOnly,
        sourceBank,
        entryType: 'individual',
        user,
      });
      saved = { rows: [inserted.item] };
      list = inserted.list;
      snapshot = inserted.snapshot;
    }

    await logAudit(client, {
      entityType: 'advance_list',
      entityId: list.id,
      action: 'individual_advance_create',
      newValue: {
        item_id: saved.rows[0].id,
        employee_id: employee.id,
        employee_name: employee.full_name,
        amount,
        receipt_at: receipt.timestamp,
        source_bank: sourceBank,
        projected_percentage: snapshot.projectedPercentage,
        exceeded: snapshot.exceeded,
        installments: installmentInfo,
      },
      userId: user.id,
    });

    return {
      item: saved.rows[0],
      list,
      result: {
        ...buildCycleLimitResult(employee, snapshot.projectedTotal),
        amount,
        posted_amount: Number(saved.rows[0].amount),
        total_used: snapshot.projectedTotal,
        remaining: snapshot.remaining,
        exceeded: snapshot.exceeded,
        status_level: percentageClass(snapshot.projectedPercentage),
        installment: installmentInfo,
      },
    };
  });
}

export async function listEligibleIndividualAdvances(employeeId, user) {
  assertSpecificAdvancePermission(user, 'advances.installments.convert', 'Você não possui permissão para parcelar vales.');
  return transaction(async (client) => {
    if (!employeeId) throw httpError(400, 'Selecione um funcionario.');
    await fetchEmployeeForAdvance(client, employeeId, false);
    const openCycle = await fetchOpenCycle(client);
    if (!openCycle) return { open_cycle: null, items: [] };
    const result = await client.query(
      `SELECT ali.id, ali.amount, ali.receipt_at, ali.source_bank, ali.entry_type,
        al.id AS list_id, al.list_date, al.status AS list_status,
        ac.id AS cycle_id, ac.opened_at, ac.status AS cycle_status
       FROM advance_list_items ali
       JOIN advance_lists al ON al.id = ali.list_id
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       LEFT JOIN advance_installment_plans aip ON aip.original_individual_advance_id = ali.id
       WHERE ali.employee_id = $1
         AND ac.id = $2
         AND ac.status = 'open'
         AND al.status <> 'cancelled'
         AND al.deleted_at IS NULL
         AND ali.status = 'active'
         AND ali.removed_at IS NULL
         AND ali.confirmed = TRUE
         AND ali.entry_type = 'individual'
         AND aip.id IS NULL
       ORDER BY COALESCE(ali.receipt_at, ali.created_at) DESC`,
      [employeeId, openCycle.id],
    );
    return { open_cycle: openCycle, items: result.rows };
  });
}

export async function convertIndividualAdvanceToInstallments(itemId, body, user) {
  assertSpecificAdvancePermission(user, 'advances.installments.convert', 'Você não possui permissão para parcelar vales.');
  return advanceWriteTransaction(async (client) => {
    const installmentsCount = validateInstallmentsCount(body.installments_count, { min: 2 });
    const current = await client.query(
      `SELECT ali.*, al.cycle_id, al.status AS list_status, ac.status AS cycle_status,
        e.id AS employee_id, e.full_name, e.current_salary, e.employment_status
       FROM advance_list_items ali
       JOIN advance_lists al ON al.id = ali.list_id
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       JOIN employees e ON e.id = ali.employee_id
       LEFT JOIN advance_installment_plans aip ON aip.original_individual_advance_id = ali.id
       WHERE ali.id = $1
         AND ali.status = 'active'
         AND ali.removed_at IS NULL
         AND ali.confirmed = TRUE
         AND ali.entry_type = 'individual'
         AND al.status <> 'cancelled'
         AND al.deleted_at IS NULL
         AND ac.status = 'open'
         AND aip.id IS NULL
       FOR UPDATE OF ali`,
      [itemId],
    );
    const item = current.rows[0];
    if (!item) throw httpError(404, 'Vale individual elegivel nao encontrado.');

    const amount = Number(item.amount);
    const planData = await createInstallmentPlan(client, {
      employee: item,
      originalItemId: item.id,
      originalAmount: amount,
      installmentsCount,
      user,
    });
    const firstInstallment = planData.installments[0];
    const posted = await postInstallment(client, {
      cycle: { id: item.cycle_id },
      installment: firstInstallment,
      employee: item,
      user,
      receiptAt: item.receipt_at,
      receiptDate: item.list_date,
      sourceBank: item.source_bank,
      reuseItemId: item.id,
    });
    await finalizeInstallmentPlanIfNeeded(client, planData.plan.id, user);

    await logAudit(client, {
      entityType: 'advance_installment_plan',
      entityId: planData.plan.id,
      action: 'installment_plan_convert',
      previousValue: {
        item_id: item.id,
        amount_before: amount,
      },
      newValue: {
        item_id: item.id,
        amount_after: Number(firstInstallment.installment_amount),
        original_amount: amount,
        installments_count: installmentsCount,
        future_installments: installmentsCount - 1,
      },
      userId: user.id,
    });

    return {
      item: posted.item,
      result: {
        ...buildCycleLimitResult(item, posted.snapshot.projectedTotal),
        amount,
        posted_amount: Number(firstInstallment.installment_amount),
        total_used: posted.snapshot.projectedTotal,
        remaining: posted.snapshot.remaining,
        exceeded: posted.snapshot.exceeded,
        status_level: percentageClass(posted.snapshot.projectedPercentage),
        installment: {
          plan_id: planData.plan.id,
          original_amount: amount,
          installments_count: installmentsCount,
          current_installment_number: 1,
          current_installment_amount: Number(firstInstallment.installment_amount),
          remaining_installments: installmentsCount - 1,
          amounts: planData.amounts,
        },
      },
    };
  });
}

function reportDateRange({ from, to }) {
  if (!from || !to) throw httpError(400, 'Informe data inicial e final.');
  const startDate = assertValidCivilDate(from, 'Periodo invalido.');
  const endDate = assertValidCivilDate(to, 'Periodo invalido.');
  if (endDate < startDate) throw httpError(400, 'A data final nao pode ser anterior a inicial.');
  return {
    start: `${startDate} 00:00:00`,
    end: `${endDate} 23:59:59.999`,
  };
}

async function resolveReportFilter(client, query) {
  if (query.cycle_id) {
    const cycle = await client.query(
      `SELECT ac.*, opener.name AS opened_by_name, closer.name AS closed_by_name
       FROM advance_cycles ac
       LEFT JOIN users opener ON opener.id = ac.opened_by
       LEFT JOIN users closer ON closer.id = ac.closed_by
       WHERE ac.id = $1`,
      [query.cycle_id],
    );
    if (!cycle.rows[0]) throw httpError(404, 'Ciclo nao encontrado.');
    return { type: 'cycle', cycle: cycle.rows[0], where: 'ac.id = $1', params: [query.cycle_id] };
  }
  if (query.mode === 'period') {
    const { start, end } = reportDateRange(query);
    return {
      type: 'period',
      period: { from: query.from, to: query.to },
      where: 'COALESCE(ali.receipt_at, ali.created_at, al.list_date::timestamp) BETWEEN $1 AND $2',
      params: [start, end],
    };
  }
  const cycle = await client.query(
    `SELECT ac.*, opener.name AS opened_by_name, closer.name AS closed_by_name
     FROM advance_cycles ac
     LEFT JOIN users opener ON opener.id = ac.opened_by
     LEFT JOIN users closer ON closer.id = ac.closed_by
     WHERE ac.status = 'open'`,
  );
  if (!cycle.rows[0]) throw httpError(404, 'Nao ha ciclo aberto.');
  return { type: 'current', cycle: cycle.rows[0], where: 'ac.id = $1', params: [cycle.rows[0].id] };
}

export async function getGeneralAdvanceReport(query, user) {
  assertCan(user, 'advances.reports.general');
  return transaction(async (client) => {
    const filter = await resolveReportFilter(client, query);
    const result = await client.query(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, e.job_title, s.name AS sector_name,
        COALESCE(SUM(ali.amount), 0)::numeric AS total_amount
       FROM advance_list_items ali
       JOIN advance_lists al ON al.id = ali.list_id
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       JOIN employees e ON e.id = ali.employee_id
       LEFT JOIN sectors s ON s.id = e.sector_id
       WHERE ${filter.where}
         AND al.status <> 'cancelled'
         AND al.deleted_at IS NULL
         AND ali.status = 'active'
         AND ali.removed_at IS NULL
         AND ali.confirmed = TRUE
       GROUP BY e.id, e.full_name, e.job_title, s.name
       ORDER BY e.full_name`,
      filter.params,
    );
    const total = result.rows.reduce((sum, row) => sum + Number(row.total_amount), 0);
    return { filter, rows: result.rows, total_amount: total };
  });
}

export async function getIndividualAdvanceReport(employeeId, query, user) {
  assertCan(user, 'advances.reports.individual');
  return transaction(async (client) => {
    const employee = await fetchEmployeeForAdvance(client, employeeId, false, true);
    const filter = await resolveReportFilter(client, query);
    const params = [...filter.params, employeeId];
    const employeeParam = params.length;
    const entries = await client.query(
      `SELECT ali.id, ali.amount, ali.receipt_at, ali.source_bank, ali.entry_type, ali.created_at,
        al.list_date, ac.id AS cycle_id, ac.opened_at, ac.closed_at,
        ai.installment_number, aip.installments_count, aip.original_amount
       FROM advance_list_items ali
       JOIN advance_lists al ON al.id = ali.list_id
       JOIN advance_cycles ac ON ac.id = al.cycle_id
       LEFT JOIN advance_installments ai ON ai.posted_advance_item_id = ali.id
       LEFT JOIN advance_installment_plans aip ON aip.id = ai.plan_id
       WHERE ${filter.where}
         AND ali.employee_id = $${employeeParam}
         AND al.status <> 'cancelled'
         AND al.deleted_at IS NULL
         AND ali.status = 'active'
         AND ali.removed_at IS NULL
         AND ali.confirmed = TRUE
       ORDER BY COALESCE(ali.receipt_at, ali.created_at, al.list_date::timestamp) ASC`,
      params,
    );
    const futurePlans = await client.query(
      `SELECT aip.id, aip.original_amount, aip.installments_count, aip.status,
        COALESCE(SUM(ai.installment_amount) FILTER (WHERE ai.status = 'posted'), 0)::numeric AS posted_amount,
        COALESCE(COUNT(ai.id) FILTER (WHERE ai.status = 'posted'), 0)::int AS posted_count,
        COALESCE(COUNT(ai.id) FILTER (WHERE ai.status = 'pending'), 0)::int AS pending_count,
        COALESCE(SUM(ai.installment_amount) FILTER (WHERE ai.status = 'pending'), 0)::numeric AS pending_amount
       FROM advance_installment_plans aip
       LEFT JOIN advance_installments ai ON ai.plan_id = aip.id
       WHERE aip.employee_id = $1 AND aip.status IN ('active', 'completed')
       GROUP BY aip.id
       HAVING COALESCE(COUNT(ai.id) FILTER (WHERE ai.status = 'pending'), 0) > 0
       ORDER BY aip.created_at DESC`,
      [employeeId],
    );
    const total = entries.rows.reduce((sum, row) => sum + Number(row.amount), 0);
    return { employee, filter, entries: entries.rows, future_plans: futurePlans.rows, total_amount: total };
  });
}

export async function getClosedAdvanceCyclesReport(user) {
  assertCan(user, 'advances.reports.cycles');
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT ac.*, opener.name AS opened_by_name, closer.name AS closed_by_name,
        COALESCE(COUNT(DISTINCT ali.employee_id) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL), 0)::int AS employee_count,
        COALESCE(SUM(ali.amount) FILTER (WHERE ali.status = 'active' AND ali.removed_at IS NULL AND al.status <> 'cancelled'), 0)::numeric AS total_amount,
        COALESCE(COUNT(DISTINCT al.id), 0)::int AS list_count
       FROM advance_cycles ac
       LEFT JOIN users opener ON opener.id = ac.opened_by
       LEFT JOIN users closer ON closer.id = ac.closed_by
       LEFT JOIN advance_lists al ON al.cycle_id = ac.id AND al.deleted_at IS NULL
       LEFT JOIN advance_list_items ali ON ali.list_id = al.id
       WHERE ac.status = 'closed'
       GROUP BY ac.id, opener.name, closer.name
       ORDER BY ac.closed_at DESC`,
    );
    return result.rows;
  });
}

export async function getAdvanceAuditReport(query, user) {
  assertCan(user, 'advances.audit.view');
  return transaction(async (client) => {
    const params = [];
    const conditions = ["entity_type IN ('advance_list', 'advance_cycle', 'advance_installment_plan')"];
    if (query.action) {
      params.push(query.action);
      conditions.push(`action = $${params.length}`);
    }
    if (query.user_id) {
      params.push(query.user_id);
      conditions.push(`user_id = $${params.length}`);
    }
    if (query.employee_id) {
      params.push(query.employee_id);
      conditions.push(`(new_value->>'employee_id' = $${params.length} OR previous_value->>'employee_id' = $${params.length})`);
    }
    if (query.from) {
      params.push(new Date(`${String(query.from).slice(0, 10)}T00:00:00`));
      conditions.push(`created_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(new Date(`${String(query.to).slice(0, 10)}T23:59:59.999`));
      conditions.push(`created_at <= $${params.length}`);
    }
    const result = await client.query(
      `SELECT al.*, u.name AS user_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY al.created_at DESC
       LIMIT 200`,
      params,
    );
    return result.rows;
  });
}
