import { transaction } from '../database/pool.js';
import { hasPermission } from './permissionService.js';
import { logAudit } from './auditService.js';
import { httpError } from '../utils/httpError.js';

const fields = { current_salary: 'salary', meal_allowance: 'meal_allowance' };
export function canManageCompensation(user, field) {
  const permission = fields[field];
  return hasPermission(user, 'employees.view') && hasPermission(user, `employees.${permission}.view`)
    && (hasPermission(user, `employees.${permission}.manage`) || hasPermission(user, 'employees.manage'));
}
function assertAccess(user) {
  if (!Object.keys(fields).some((field) => canManageCompensation(user, field))) throw httpError(403, 'Sem permissão para atualização de remuneração.');
}
function visible(row, user) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !fields[key] || canManageCompensation(user, key)));
}
export async function compensationEmployees(user) {
  assertAccess(user);
  return transaction(async (client) => (await client.query(`SELECT id, full_name, current_salary, meal_allowance FROM employees
    WHERE deleted_at IS NULL AND employment_status = 'ativo' ORDER BY full_name`)).rows.map((row) => visible(row, user)));
}
export function validateCompensation(body, current, user) {
  assertAccess(user);
  if (!body || Object.keys(body).some((key) => ![...Object.keys(fields), 'expected', 'effective_from'].includes(key))) throw httpError(400, 'Campos não autorizados.');
  if (body.effective_from && (!/^\d{4}-\d{2}-\d{2}$/.test(body.effective_from) || !Number.isFinite(Date.parse(body.effective_from)) || new Date(body.effective_from).toISOString().slice(0, 10) !== body.effective_from)) throw httpError(400, 'Data de vigência inválida.', { field: 'effective_from' });
  const changes = [];
  for (const field of Object.keys(fields)) {
    const value = body[field];
    if (value === undefined || value === null || value === '') continue;
    if (!canManageCompensation(user, field)) throw httpError(403, 'Sem permissão para alterar este valor.');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9999999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) throw httpError(400, 'Informe um valor monetário válido, com até duas casas decimais.', { field });
    if (current[field] === null) throw httpError(400, 'Preencha o valor atual na ficha individual antes de usar a atualização rápida.', { field });
    const previous = Number(current[field]);
    if (value === previous) continue;
    if (value < previous) throw httpError(400, 'O novo valor deve ser maior que o atual.', { field });
    if (body.expected?.[field] === undefined || Number(body.expected[field]) !== previous) throw httpError(409, 'O cadastro foi alterado. Selecione o funcionário novamente e confira os valores.');
    changes.push({ field, previous, value, difference: Math.round((value - previous) * 100) / 100, percentage: field === 'current_salary' && previous > 0 ? (value - previous) / previous * 100 : null });
  }
  return changes;
}
export async function updateCompensation(id, body, user) {
  assertAccess(user);
  return transaction(async (client) => {
    const current = (await client.query(`SELECT id, full_name, current_salary, meal_allowance FROM employees
      WHERE id = $1 AND deleted_at IS NULL AND employment_status = 'ativo' FOR UPDATE`, [id])).rows[0];
    if (!current) throw httpError(404, 'Funcionário ativo não encontrado.');
    const changes = validateCompensation(body, current, user);
    for (const change of changes) {
      const { field, previous, value } = change;
      await client.query(`UPDATE employees SET ${field} = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`, [value, user.id, id]);
      const columns = field === 'current_salary' ? 'previous_salary, salary' : 'previous_amount, new_amount';
      const table = field === 'current_salary' ? 'employee_salary_history' : 'employee_meal_allowance_history';
      await client.query(`INSERT INTO ${table} (employee_id, ${columns}, effective_from, reason, created_by)
        VALUES ($1, $2, $3, COALESCE($4::date, (NOW() AT TIME ZONE 'America/Cuiaba')::date), 'Atualização rápida', $5)`, [id, previous, value, body.effective_from || null, user.id]);
      await logAudit(client, { entityType: 'employee', entityId: id, action: `${fields[field]}_change`, previousValue: { [field]: previous }, newValue: { [field]: value, difference: change.difference, percentage: change.percentage, effective_from: body.effective_from || null, origin: 'atualizacao_rapida' }, userId: user.id });
      current[field] = value;
    }
    return { employee: visible(current, user), changes, message: changes.length ? 'Alterações salvas com sucesso.' : 'Nenhuma alteração realizada.' };
  });
}
export function reportPeriod(query) {
  const month = Number(query.month), year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1900 || year > 9998) throw httpError(400, 'Mês ou ano inválido.');
  return { month, year, start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01` };
}
export async function compensationReport(query, user) {
  assertAccess(user);
  // A monthly accounting report must never silently omit a protected remuneration type.
  if (!Object.keys(fields).every((field) => hasPermission(user, `employees.${fields[field]}.view`))) throw httpError(403, 'O relatório exige permissão para visualizar salário e vale-alimentação.');
  const period = reportPeriod(query);
  return transaction(async (client) => {
    const result = await client.query(`SELECT h.*, e.full_name, h.new_value - h.previous_value AS difference,
      CASE WHEN h.type = 'salary' AND h.previous_value > 0 THEN (h.new_value - h.previous_value) / h.previous_value * 100 END AS percentage
      FROM (
        SELECT employee_id, 'salary' AS type, previous_salary AS previous_value, salary AS new_value, effective_from::text, created_at::text, created_by, reason FROM employee_salary_history
        UNION ALL
        SELECT employee_id, 'meal_allowance', previous_amount, new_amount, effective_from::text, created_at::text, created_by, reason FROM employee_meal_allowance_history
      ) h JOIN employees e ON e.id = h.employee_id
      WHERE h.created_at::timestamp >= $1::date AND h.created_at::timestamp < $2::date
        AND h.previous_value IS NOT NULL AND h.previous_value <> h.new_value
      ORDER BY e.full_name, h.created_at`, [period.start, period.end]);
    return { ...period, rows: result.rows };
  });
}
