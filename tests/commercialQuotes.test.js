import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import {
  calculateQuoteTotals,
  changeCommercialQuoteStatus,
  commercialQuoteInternals,
  createCommercialQuote,
  duplicateCommercialQuote,
  getCommercialQuote,
  updateCommercialQuote,
} from '../backend/src/services/commercialQuoteService.js';
import { requirePermission } from '../backend/src/middlewares/authMiddleware.js';

after(async () => pool.end());

function run(middleware, permissions) {
  let received;
  middleware({ user: { username: 'synthetic', permissions } }, {}, (error) => { received = error || null; });
  return received;
}

test('cálculo monetário usa quantidade, descontos em valor e frete sem ponto flutuante persistido', () => {
  const result = calculateQuoteTotals([
    { quantity: '2.500', unit_price: '100.10', discount_amount: '0.25' },
    { quantity: 1, unit_price: 50, discount_amount: 10 },
  ], 5, 12.5);
  assert.deepEqual(result.totals, {
    items_gross_total: '300.25',
    items_discount_total: '10.25',
    subtotal: '290.00',
    discount_amount: '5.00',
    freight_amount: '12.50',
    total: '297.50',
  });
  assert.throws(
    () => calculateQuoteTotals([{ quantity: 1, unit_price: 10, discount_amount: 11 }]),
    (error) => error.status === 400 && error.field === 'items.0.discount_amount',
  );
});

test('parcelas preservam todos os centavos e percentual é modo explícito', () => {
  const parts = commercialQuoteInternals.distributeInstallments(10000n, 3);
  assert.deepEqual(parts, [3334n, 3333n, 3333n]);
  const methods = commercialQuoteInternals.buildPaymentMethods([
    { method_type: 'pix', calculation_type: 'percentage', percentage: 40, installment_count: 1 },
    { method_type: 'bank_slip', calculation_type: 'amount', amount: 60, installment_count: 3, first_due_date: '2026-09-30' },
  ], '100.00');
  assert.equal(methods[0].amount, '40.00');
  assert.deepEqual(methods[1].installments.map((item) => item.amount), ['20.00', '20.00', '20.00']);
  assert.deepEqual(methods[1].installments.map((item) => item.due_date), ['2026-09-30', '2026-10-30', '2026-11-30']);
});

test('RBAC separa leitura, criação, edição, aprovação e cancelamento', () => {
  const viewer = ['commercial.quotes.view'];
  assert.equal(run(requirePermission('commercial.quotes.view'), viewer), null);
  ['commercial.quotes.create', 'commercial.quotes.edit', 'commercial.quotes.approve', 'commercial.quotes.cancel']
    .forEach((permission) => assert.equal(run(requirePermission(permission), viewer)?.status, 403));
});

test('migrations são aditivas, numerações são atômicas e aprovação não acopla domínios operacionais', () => {
  const migration = fs.readFileSync(new URL('../database/migrations/20260817_zz_commercial_quotes.sql', import.meta.url), 'utf8');
  const commercialNumberMigration = fs.readFileSync(new URL('../database/migrations/20260824_commercial_quote_commercial_number.sql', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../backend/src/services/commercialQuoteService.js', import.meta.url), 'utf8');
  assert.match(service, /ON CONFLICT \(counter_year\) DO UPDATE/);
  assert.match(commercialNumberMigration, /VALUES \('global', 249\)/);
  assert.match(commercialNumberMigration, /UNIQUE \(commercial_number\)/);
  assert.match(commercialNumberMigration, /OLD\.commercial_number IS DISTINCT FROM NEW\.commercial_number/);
  assert.match(service, /nextCommercialNumber/);
  assert.match(service, /commercial_number::text/);
  assert.doesNotMatch(service, /\bMAX\s*\(/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(commercialNumberMigration, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(service, /orderService|internal_orders|sold_items|shipment_volumes|internal_tasks|stock|purchase|label/i);
  assert.match(migration, /WHERE r\.slug = 'admin'/);
  assert.doesNotMatch(migration, /DELETE FROM role_permissions/i);
});

test('fluxo completo preserva snapshots, item manual, estados, duplicação e isolamento operacional', async () => {
  const fixture = await pool.query(`
    SELECT
      (SELECT id FROM users WHERE is_active = TRUE AND approval_status = 'approved' ORDER BY CASE WHEN username = 'felipe' THEN 0 ELSE 1 END, id LIMIT 1) AS user_id,
      (SELECT id FROM customers WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1) AS customer_id,
      (SELECT id FROM products WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1) AS product_id
  `);
  const { user_id: userId, customer_id: customerId, product_id: productId } = fixture.rows[0];
  assert.ok(userId && customerId && productId, 'o teste requer usuário, cliente e Produto ativos');
  const user = { id: userId, username: 'synthetic-admin', permissions: ['commercial.quotes.view', 'commercial.quotes.create', 'commercial.quotes.edit', 'commercial.quotes.approve', 'commercial.quotes.cancel'] };

  const realConnect = pool.connect.bind(pool);
  const client = await realConnect();
  await client.query('BEGIN');
  const wrapper = {
    async query(text, params) {
      const command = typeof text === 'string' ? text.trim().toUpperCase() : '';
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(command)) return { rows: [], rowCount: 0 };
      return client.query(text, params);
    },
    release() {},
  };
  pool.connect = async () => wrapper;
  try {
    const commercialCounterBefore = Number((await client.query(
      "SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key = 'global'",
    )).rows[0].last_value);
    const beforeOperational = (await client.query(`SELECT
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM internal_orders) AS orders,
      (SELECT COUNT(*)::int FROM sold_items) AS items,
      (SELECT COUNT(*)::int FROM internal_tasks) AS tasks,
      (SELECT COUNT(*)::int FROM shipment_volumes) AS volumes`)).rows[0];
    const customerCountBefore = (await client.query('SELECT COUNT(*)::int total FROM customers')).rows[0].total;
    const commercialProductCountBefore = (await client.query('SELECT COUNT(*)::int total FROM commercial_products')).rows[0].total;
    const freeTextQuote = await createCommercialQuote({ customer_name: 'João avulso', items: [{ name: 'Manual avulso', quantity: 1, unit_price: 10, save_product: true }], payment_methods: [{ method_type: 'pix', calculation_type: 'amount', amount: 10 }] }, user);
    const anonymousQuote = await createCommercialQuote({ items: [{ name: 'Manual anônimo', quantity: 1, unit_price: 20, save_product: false }], payment_methods: [{ method_type: 'cash', calculation_type: 'amount', amount: 20 }] }, user);
    assert.equal(freeTextQuote.commercial_number, String(commercialCounterBefore + 1));
    assert.equal(anonymousQuote.commercial_number, String(commercialCounterBefore + 2));
    assert.equal(freeTextQuote.customer_id, null);
    assert.equal(freeTextQuote.customer_snapshot.name, 'João avulso');
    assert.equal(anonymousQuote.customer_id, null);
    assert.equal(anonymousQuote.customer_name_snapshot, 'Cliente não identificado');
    assert.equal(anonymousQuote.items[0].save_product_requested, false);
    assert.ok(freeTextQuote.items[0].commercial_product_id);
    assert.equal(freeTextQuote.items[0].product_id, null);
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM customers')).rows[0].total, customerCountBefore);
    const product = (await client.query('SELECT name, internal_code, measurement_unit_code FROM products WHERE id = $1', [productId])).rows[0];
    const customer = (await client.query('SELECT name, tax_id, city FROM customers WHERE id = $1', [customerId])).rows[0];

    const created = await createCommercialQuote({
      customer_id: customerId,
      quote_date: '2026-08-17',
      valid_until: '2026-09-17',
      discount_amount: 10,
      freight_amount: 20,
      items: [
        { product_id: productId, description: 'Descrição comercial congelada', quantity: 2, unit_price: 100, discount_amount: 10 },
        { name: 'Instalação pontual', code: 'MAN-1', unit: 'SV', description: 'Item manual', quantity: 1, unit_price: 50, discount_amount: 0 },
      ],
      payment_methods: [
        { method_type: 'pix', description: 'Entrada PIX', calculation_type: 'percentage', percentage: 40, installment_count: 1 },
        { method_type: 'bank_slip', description: 'Saldo em boleto', calculation_type: 'amount', amount: 150, installment_count: 3, first_due_date: '2026-09-17' },
      ],
    }, user);
    assert.match(created.quote_number, /^ORC-2026-\d{6}$/);
    assert.equal(created.commercial_number, String(commercialCounterBefore + 3));
    assert.notEqual(String(created.commercial_number), created.quote_number);
    assert.equal(created.total, '250.00');
    assert.equal(created.customer_snapshot.name, customer.name);
    assert.equal(created.items[0].product_name_snapshot, product.name);
    assert.equal(created.items[0].product_code_snapshot, product.internal_code);
    assert.equal(created.items[0].measurement_unit_snapshot, product.measurement_unit_code);
    assert.equal(created.items[1].item_type, 'product');
    assert.equal(created.items[1].product_id, null);
    assert.ok(created.items[1].commercial_product_id);
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM commercial_products')).rows[0].total, commercialProductCountBefore + 2);

    await client.query("UPDATE customers SET name = 'Cliente alterado depois' WHERE id = $1", [customerId]);
    await client.query("UPDATE products SET name = 'Produto alterado depois' WHERE id = $1", [productId]);
    const historical = await getCommercialQuote(created.id, client);
    assert.equal(historical.customer_snapshot.name, customer.name);
    assert.equal(historical.items[0].product_name_snapshot, product.name);

    const updated = await updateCommercialQuote(created.id, {
      customer_id: customerId, quote_date: '2026-08-17', valid_until: '2026-09-17', discount_amount: 0, freight_amount: 0,
      items: [{ product_id: productId, description: 'Descrição atualizada no rascunho', quantity: 1, unit_price: 80, discount_amount: 0 }],
      payment_methods: [{ method_type: 'pix', calculation_type: 'amount', amount: 80, installment_count: 1 }],
    }, user);
    assert.equal(updated.total, '80.00');

    const sent = await changeCommercialQuoteStatus(created.id, 'sent', user);
    assert.equal(sent.status, 'sent');
    const official = (await client.query('SELECT * FROM commercial_quote_documents WHERE commercial_quote_id = $1', [created.id])).rows;
    assert.equal(official.length, 1);
    assert.equal(official[0].pdf_data.subarray(0, 5).toString(), '%PDF-');
    assert.match(official[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(official[0].sha256, createHash('sha256').update(official[0].pdf_data).digest('hex'));
    await assert.rejects(
      updateCommercialQuote(created.id, { customer_id: customerId, items: [] }, user),
      (error) => error.status === 409 && error.code === 'QUOTE_NOT_EDITABLE',
    );
    const approved = await changeCommercialQuoteStatus(created.id, 'approved', user);
    assert.equal(approved.status, 'approved');
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM commercial_quote_documents WHERE commercial_quote_id = $1', [created.id])).rows[0].total, 1);
    assert.equal(approved.history.some((event) => event.action === 'approved'), true);
    await assert.rejects(
      updateCommercialQuote(created.id, { customer_id: customerId, items: [] }, user),
      (error) => error.status === 409 && error.code === 'QUOTE_NOT_EDITABLE',
    );

    const duplicated = await duplicateCommercialQuote(created.id, user);
    assert.equal(duplicated.status, 'draft');
    assert.notEqual(duplicated.quote_number, created.quote_number);
    assert.equal(duplicated.commercial_number, String(commercialCounterBefore + 4));
    assert.equal(duplicated.items[0].product_name_snapshot, updated.items[0].product_name_snapshot);
    assert.equal(duplicated.total, approved.total);

    await changeCommercialQuoteStatus(duplicated.id, 'sent', user);
    const rejected = await changeCommercialQuoteStatus(duplicated.id, 'rejected', user);
    assert.equal(rejected.status, 'rejected');

    const cancelCandidate = await duplicateCommercialQuote(created.id, user);
    assert.equal(cancelCandidate.commercial_number, String(commercialCounterBefore + 5));
    await changeCommercialQuoteStatus(cancelCandidate.id, 'sent', user);
    const cancelled = await changeCommercialQuoteStatus(cancelCandidate.id, 'cancelled', user);
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(
      changeCommercialQuoteStatus(cancelled.id, 'approved', user),
      (error) => error.status === 409 && error.code === 'QUOTE_STATUS_TRANSITION_INVALID',
    );

    await client.query('SAVEPOINT commercial_number_immutability');
    await assert.rejects(
      client.query('UPDATE commercial_quotes SET commercial_number = 999 WHERE id = $1', [created.id]),
      /commercial_number é imutável/,
    );
    await client.query('ROLLBACK TO SAVEPOINT commercial_number_immutability');

    await client.query('SAVEPOINT commercial_number_uniqueness');
    await client.query("UPDATE commercial_quote_commercial_counters SET last_value = 249 WHERE counter_key = 'global'");
    await assert.rejects(
      duplicateCommercialQuote(created.id, user),
      (error) => error.code === '23505' && /commercial_number/.test(error.constraint || ''),
    );
    await client.query('ROLLBACK TO SAVEPOINT commercial_number_uniqueness');

    const afterOperational = (await client.query(`SELECT
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM internal_orders) AS orders,
      (SELECT COUNT(*)::int FROM sold_items) AS items,
      (SELECT COUNT(*)::int FROM internal_tasks) AS tasks,
      (SELECT COUNT(*)::int FROM shipment_volumes) AS volumes`)).rows[0];
    assert.deepEqual(afterOperational, beforeOperational);

    await client.query('UPDATE products SET is_active = FALSE WHERE id = $1', [productId]);
    await assert.rejects(
      createCommercialQuote({ customer_id: customerId, items: [{ product_id: productId, quantity: 1, unit_price: 1 }] }, user),
      (error) => error.status === 400 && error.code === 'PRODUCT_INACTIVE',
    );
    await assert.rejects(
      createCommercialQuote({ customer_id: customerId, items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1, unit_price: 1 }] }, user),
      (error) => error.status === 400 && error.code === 'PRODUCT_NOT_FOUND',
    );
  } finally {
    pool.connect = realConnect;
    await client.query('ROLLBACK');
    client.release();
  }
});

test('contador anual serializa concorrência e produz números únicos', async () => {
  const year = 9998;
  await pool.query('DELETE FROM commercial_quote_counters WHERE counter_year = $1', [year]);
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  try {
    await firstClient.query('BEGIN');
    await secondClient.query('BEGIN');
    const first = await commercialQuoteInternals.nextQuoteNumber(firstClient, `${year}-01-01`);
    const secondPromise = commercialQuoteInternals.nextQuoteNumber(secondClient, `${year}-01-01`);
    await firstClient.query('COMMIT');
    const second = await secondPromise;
    await secondClient.query('COMMIT');
    assert.notEqual(first, second);
    assert.deepEqual([first, second], [`ORC-${year}-000001`, `ORC-${year}-000002`]);
  } catch (error) {
    await firstClient.query('ROLLBACK').catch(() => {});
    await secondClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    firstClient.release();
    secondClient.release();
    await pool.query('DELETE FROM commercial_quote_counters WHERE counter_year = $1', [year]);
  }
});

test('contador comercial global serializa concorrência sem tocar a faixa real', async () => {
  const globalBefore = await pool.query("SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key = 'global'");
  const counterKey = `test-${process.pid}-${Date.now()}`;
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  try {
    await firstClient.query('BEGIN');
    await secondClient.query('BEGIN');
    const first = await commercialQuoteInternals.nextCommercialNumber(firstClient, counterKey);
    const secondPromise = commercialQuoteInternals.nextCommercialNumber(secondClient, counterKey);
    await firstClient.query('COMMIT');
    const second = await secondPromise;
    await secondClient.query('COMMIT');
    assert.deepEqual([first, second], [250, 251]);
  } catch (error) {
    await firstClient.query('ROLLBACK').catch(() => {});
    await secondClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    firstClient.release();
    secondClient.release();
    await pool.query('DELETE FROM commercial_quote_commercial_counters WHERE counter_key = $1', [counterKey]);
  }
  const global = await pool.query("SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key = 'global'");
  assert.equal(global.rows[0].last_value, globalBefore.rows[0].last_value);
});
