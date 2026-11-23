import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';

const summary = `id, version, created_at, created_by, updated_at, updated_by, finalized_at, finalized_by,
  jsonb_array_length(items) AS employee_count, total_cents`;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function paymentItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 1000) {
    throw httpError(400, 'Informe de 1 a 1.000 funcionários.');
  }
  const ids = new Set();
  return items.map((item) => {
    if (typeof item?.employee_id !== 'string' || !uuid.test(item.employee_id)
      || !Number.isSafeInteger(item.amount_cents) || item.amount_cents <= 0 || item.amount_cents > 999999999999) {
      throw httpError(400, 'Informe um funcionário e um valor positivo com até duas casas decimais.');
    }
    const employee_id = item.employee_id.toLowerCase();
    if (ids.has(employee_id)) throw httpError(400, 'Funcionário duplicado na relação.');
    ids.add(employee_id);
    return { employee_id, amount_cents: item.amount_cents };
  });
}

export async function listPayments() {
  return (await query(`SELECT ${summary} FROM employee_payments ORDER BY id DESC`)).rows;
}

export async function paymentEmployees() {
  return (await query(`SELECT id, full_name, pix_key FROM employees
    WHERE deleted_at IS NULL AND employment_status = 'ativo' ORDER BY full_name, id`)).rows;
}

async function loadPayment(client, id, lock = false) {
  if (!/^\d{1,10}$/.test(id) || Number(id) > 2147483647) throw httpError(404, 'Relação não encontrada.');
  const payment = (await client.query(`SELECT ${summary}, items FROM employee_payments
    WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!payment) throw httpError(404, 'Relação não encontrada.');
  return payment;
}

async function snapshot(client, items, { lock = false, allowInactive = false } = {}) {
  const { rows } = await client.query(`SELECT id, full_name, pix_key
    FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND employment_status = 'ativo'
    ORDER BY id ${lock ? 'FOR SHARE' : ''}`, [items.map(({ employee_id }) => employee_id)]);
  const employees = new Map(rows.map((row) => [row.id, row]));
  return items.map(({ employee_id, amount_cents, full_name }) => {
    const employee = employees.get(employee_id);
    if (!employee && !allowInactive) throw httpError(409, 'Remova os funcionários que não estão mais ativos.');
    return {
      employee_id, amount_cents,
      full_name: employee?.full_name ?? full_name,
      pix_key: employee?.pix_key ?? null,
    };
  });
}

export async function getPayment(id) {
  return transaction(async (client) => {
    const payment = await loadPayment(client, id);
    return payment;
  });
}

function checkVersion(payment, version) {
  if (payment.version !== version) throw httpError(409, 'A relação mudou. Reabra o rascunho e confira os dados.');
}

async function audit(client, payment, action, userId) {
  await logAudit(client, {
    entityType: 'employee_payment', entityId: payment.audit_id, action, userId,
    newValue: { version: payment.version, employee_count: payment.employee_count, total_cents: payment.total_cents },
  });
}

export async function savePayment(id, body, userId) {
  const input = paymentItems(body?.items);
  const total = input.reduce((sum, row) => sum + row.amount_cents, 0);
  return transaction(async (client) => {
    if (id) {
      const current = await loadPayment(client, id, true);
      if (current.finalized_at) throw httpError(409, 'A relação já foi finalizada.');
      checkVersion(current, body.version);
    }
    const values = [JSON.stringify(await snapshot(client, input, { lock: true })), total];
    const { rows: [payment] } = id
      ? await client.query(`UPDATE employee_payments SET items = $1, total_cents = $2, version = version + 1,
          updated_at = NOW(), updated_by = $4
          WHERE id = $3 RETURNING ${summary}, items, audit_id`, [...values, id, userId])
      : await client.query(`INSERT INTO employee_payments (items, total_cents, created_by)
          VALUES ($1, $2, $3) RETURNING ${summary}, items, audit_id`, [...values, userId]);
    await audit(client, payment, id ? 'update_draft' : 'create_draft', userId);
    delete payment.audit_id;
    return payment;
  });
}

export async function finalizePayment(id, version, userId) {
  return transaction(async (client) => {
    const current = await loadPayment(client, id, true);
    if (current.finalized_at && current.version === version + 1) return current;
    if (current.finalized_at) throw httpError(409, 'A relação já foi finalizada.');
    checkVersion(current, version);
    const items = await snapshot(client, current.items, { lock: true });
    if (items.some((row) => !row.pix_key?.trim())) throw httpError(409, 'Cadastre as chaves Pix pendentes antes de finalizar.');
    if (items.some((row, index) => row.pix_key !== current.items[index].pix_key || row.full_name !== current.items[index].full_name)) {
      throw httpError(409, 'O cadastro de um funcionário mudou. Salve o rascunho e confira a relação novamente.');
    }
    const { rows: [payment] } = await client.query(`UPDATE employee_payments
      SET finalized_at = NOW(), finalized_by = $2, version = version + 1
      WHERE id = $1 RETURNING ${summary}, items, audit_id`, [id, userId]);
    await audit(client, payment, 'finalize', userId);
    delete payment.audit_id;
    return payment;
  });
}
