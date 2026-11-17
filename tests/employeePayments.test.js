import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../backend/src/database/pool.js';
import { buildPaymentPdf } from '../backend/src/controllers/employeePaymentController.js';
import { finalizePayment, paymentItems, savePayment } from '../backend/src/services/employeePaymentService.js';
import { parsePaymentCents } from '../src/pages/EmployeesPage/paymentAmount.js';

const id = '91234567-8901-4000-8000-000000000001';
const user = '91234567-8901-4000-8000-000000000002';
const item = { employee_id: id, amount_cents: 123456 };
const employee = { id, full_name: 'Funcionário de teste', pix_key: 'teste@example.invalid' };

test('valida valores em reais e recusa valores ou funcionários inválidos no servidor', () => {
  assert.equal(parsePaymentCents('1.234,56'), item.amount_cents);
  assert.equal(parsePaymentCents('1234.56'), item.amount_cents);
  assert.equal(parsePaymentCents('0,01'), 1);
  for (const value of ['', '0', '-1', '1,005', 'R$ 10']) assert.equal(parsePaymentCents(value), 0);
  assert.deepEqual(paymentItems([item]), [item]);
  assert.throws(() => paymentItems([item, item]), { status: 400 });
  for (const amount_cents of [0, -1, 1.5, '20']) {
    assert.throws(() => paymentItems([{ ...item, amount_cents }]), { status: 400 });
  }
});

test('salva rascunho, exige conferência atual e finaliza apenas uma vez', async (t) => {
  let payment;
  const audit = [];
  t.mock.method(pool, 'connect', async () => ({
    release() {},
    async query(sql, params) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return {};
      if (sql.includes('FROM employees')) return { rows: [employee] };
      if (sql.startsWith('SELECT')) return { rows: [structuredClone(payment)] };
      if (sql.startsWith('INSERT INTO audit_logs')) {
        audit.push(params[2]);
        return {};
      }
      if (sql.startsWith('INSERT INTO employee_payments')) {
        payment = {
          id: 1, version: 1, items: JSON.parse(params[0]), total_cents: params[1],
          employee_count: 1, audit_id: user,
        };
      } else if (sql.includes('SET items')) {
        payment = { ...payment, version: payment.version + 1, items: JSON.parse(params[0]), total_cents: params[1] };
      } else if (sql.includes('SET finalized_at')) {
        payment = { ...payment, version: payment.version + 1, finalized_at: new Date(), finalized_by: params[1] };
      } else {
        assert.fail(`SQL inesperado: ${sql}`);
      }
      return { rows: [structuredClone(payment)] };
    },
  }));
  const originalPix = employee.pix_key;
  t.after(() => { employee.pix_key = originalPix; });
  const draft = await savePayment(null, { items: [item] }, user);
  employee.pix_key = null;
  await assert.rejects(finalizePayment('1', draft.version, user), /chaves Pix pendentes/);
  employee.pix_key = 'novo@example.invalid';
  await assert.rejects(finalizePayment('1', draft.version, user), /cadastro de um funcionário mudou/);
  const reviewed = await savePayment('1', { version: draft.version, items: [item] }, user);
  await assert.rejects(finalizePayment('1', draft.version, user), { status: 409 });
  const finalized = await finalizePayment('1', reviewed.version, user);
  employee.pix_key = 'posterior@example.invalid';
  const retry = await finalizePayment('1', reviewed.version, user);
  assert.equal(retry.finalized_by, user);
  assert.equal(retry.finalized_at.getTime(), finalized.finalized_at.getTime());
  assert.equal(retry.items[0].pix_key, 'novo@example.invalid');
  await assert.rejects(savePayment('1', { version: finalized.version, items: [item] }, user), { status: 409 });
  assert.deepEqual(audit, ['create_draft', 'update_draft', 'finalize']);
});

test('gera PDF da relação com várias páginas e chaves Pix fictícias', async () => {
  const items = Array.from({ length: 75 }, (_, index) => ({ ...employee, ...item, full_name: `Funcionário de teste ${index + 1}` }));
  const pdf = await buildPaymentPdf({
    id: 2, items, total_cents: items.length * item.amount_cents, created_at: new Date('2026-11-17T20:00:00Z'),
  }, { razao_social: 'Empresa de teste' });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1);
});
