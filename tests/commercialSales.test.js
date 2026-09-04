import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../backend/src/database/pool.js';
import {
  changeCommercialQuoteStatus,
  createCommercialQuote,
  getCommercialQuote,
  updateCommercialQuote,
} from '../backend/src/services/commercialQuoteService.js';
import { getCommercialSale, listCommercialSales } from '../backend/src/services/commercialSaleService.js';

after(async () => pool.end());

const userPermissions = [
  'commercial.quotes.view', 'commercial.quotes.create', 'commercial.quotes.edit',
  'commercial.quotes.approve', 'commercial.sales.view',
];

async function fixture(database = pool) {
  const result = await database.query(`
    SELECT
      (SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY CASE WHEN username='admin' THEN 0 ELSE 1 END,id LIMIT 1) AS user_id,
      (SELECT id FROM customers WHERE is_active=TRUE ORDER BY updated_at DESC,id LIMIT 1) AS customer_id,
      (SELECT p.id FROM products p
       WHERE p.is_active=TRUE AND p.type='manufactured' AND p.review_status='approved'
         AND (
           (EXISTS(SELECT 1 FROM product_manufacturing_steps ms WHERE ms.product_id=p.id)
             AND NOT EXISTS(SELECT 1 FROM product_manufacturing_steps ms LEFT JOIN sectors s ON s.id=ms.sector_id
               WHERE ms.product_id=p.id AND (ms.sector_id IS NULL OR s.id IS NULL OR s.is_active=FALSE)))
           OR (NOT EXISTS(SELECT 1 FROM product_manufacturing_steps ms WHERE ms.product_id=p.id)
             AND EXISTS(SELECT 1 FROM product_components pc WHERE pc.product_id=p.id)
             AND NOT EXISTS(SELECT 1 FROM product_components pc LEFT JOIN sectors s ON s.id=pc.sector_id
               WHERE pc.product_id=p.id AND (pc.sector_id IS NULL OR s.id IS NULL OR s.is_active=FALSE)))
           OR (NOT EXISTS(SELECT 1 FROM product_manufacturing_steps ms WHERE ms.product_id=p.id)
             AND NOT EXISTS(SELECT 1 FROM product_components pc WHERE pc.product_id=p.id)
             AND EXISTS(SELECT 1 FROM sectors s WHERE s.id=p.sector_id AND s.is_active=TRUE))
         ) ORDER BY p.updated_at DESC,p.id LIMIT 1) AS configured_id,
      (SELECT id FROM products WHERE is_active=TRUE AND type='manufactured' AND review_status='pending_review' ORDER BY updated_at DESC,id LIMIT 1) AS pending_id,
      (SELECT id FROM products WHERE is_active=TRUE AND type='resale' ORDER BY updated_at DESC,id LIMIT 1) AS resale_id
  `);
  const row = result.rows[0];
  assert.ok(row.user_id && row.customer_id && row.configured_id && row.pending_id && row.resale_id,
    'o teste requer cliente e Produtos reais configurado, pendente e de revenda');
  return row;
}

function transactionalPoolWrapper(client, shouldFail = () => false) {
  let sequence = 0;
  const savepoints = [];
  return {
    async query(text, params) {
      const command = typeof text === 'string' ? text.trim().toUpperCase() : '';
      if (command === 'BEGIN') {
        const name = `commercial_sale_service_${sequence += 1}`;
        savepoints.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (command === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
      if (command === 'ROLLBACK') {
        const name = savepoints.pop();
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      if (shouldFail(String(text))) throw new Error('falha operacional simulada');
      return client.query(text, params);
    },
    release() {},
  };
}

test('aprovação cria uma Venda integral e envia somente item fabricável configurado à TV', async () => {
  const realConnect = pool.connect.bind(pool);
  const client = await realConnect();
  const saleSequenceBefore = (await client.query('SELECT last_value,is_called FROM commercial_sale_number_seq')).rows[0];
  await client.query('BEGIN');
  pool.connect = async () => transactionalPoolWrapper(client);
  try {
    const ids = await fixture(client);
    const user = { id: ids.user_id, username: 'commercial-sale-test', permissions: userPermissions };
    const countsBefore = (await client.query(`SELECT
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM internal_orders) AS orders,
      (SELECT COUNT(*)::int FROM sold_items) AS sold_items,
      (SELECT COUNT(*)::int FROM internal_tasks) AS tasks,
      (SELECT COUNT(*)::int FROM shipment_volumes) AS volumes,
      (SELECT COUNT(*)::int FROM purchases) AS purchases`)).rows[0];

    const quote = await createCommercialQuote({
      customer_id: ids.customer_id,
      discount_amount: '5.00',
      freight_amount: '2.00',
      notes: 'Venda mista controlada',
      items: [
        { product_id: ids.configured_id, quantity: 3, unit_price: '100.00', discount_amount: '10.00' },
        { product_id: ids.pending_id, quantity: 1, unit_price: '50.00', discount_amount: 0 },
        { product_id: ids.resale_id, quantity: 2, unit_price: '20.00', discount_amount: 0 },
        { name: 'Item comercial sem Produto interno', quantity: 1, unit_price: '10.00', discount_amount: 0, save_product: false },
      ],
      payment_methods: [{ method_type: 'pix', calculation_type: 'amount', amount: '367.00' }],
    }, user);
    await changeCommercialQuoteStatus(quote.id, 'sent', user);
    const approved = await changeCommercialQuoteStatus(quote.id, 'approved', user);
    assert.equal(approved.status, 'approved');
    assert.ok(approved.sale?.id);

    const sale = await getCommercialSale(approved.sale.id, client);
    assert.equal(sale.commercial_quote_id, quote.id);
    assert.equal(sale.commercial_number, quote.commercial_number);
    assert.equal(sale.customer_name_snapshot, quote.customer_name_snapshot);
    assert.equal(sale.total, '367.00');
    assert.equal(sale.discount_amount, '5.00');
    assert.equal(sale.freight_amount, '2.00');
    assert.equal(sale.items.length, 4);
    assert.deepEqual(sale.payment_methods_snapshot.map((method) => method.amount), ['367.00']);
    assert.deepEqual(sale.items.map((item) => item.production_status), [
      'created', 'pending_review', 'resale', 'no_operational_product',
    ]);
    assert.equal(sale.items[0].quantity, '3.000');
    assert.equal(sale.items[0].unit_discount_amount, '10.00');
    assert.equal(sale.items[0].discount_amount, '30.00');
    assert.equal(sale.items[0].subtotal, '270.00');

    const order = (await client.query('SELECT * FROM internal_orders WHERE commercial_sale_id=$1', [sale.id])).rows[0];
    assert.ok(order);
    assert.equal(order.commercial_quote_id, quote.id);
    assert.equal(order.promised_date, null);
    const produced = (await client.query(
      `SELECT si.*,COUNT(it.id)::int AS task_count
       FROM sold_items si LEFT JOIN internal_tasks it ON it.sold_item_id=si.id
       WHERE si.internal_order_id=$1 GROUP BY si.id`, [order.id],
    )).rows;
    assert.equal(produced.length, 1);
    assert.equal(produced[0].product_id, ids.configured_id);
    assert.equal(produced[0].quantity, 3);
    assert.ok(produced[0].task_count > 0);
    assert.equal((await client.query(
      'SELECT COUNT(*)::int c FROM shipment_volumes sv JOIN sold_items si ON si.id=sv.sold_item_id WHERE si.internal_order_id=$1',
      [order.id],
    )).rows[0].c, 0);
    const tvCount = (await client.query(
      `SELECT COUNT(*)::int c FROM internal_tasks it
       JOIN sold_items si ON si.id=it.sold_item_id JOIN internal_orders io ON io.id=si.internal_order_id
       JOIN sectors s ON s.id=it.sector_id
       WHERE io.commercial_sale_id=$1 AND it.status='pending' AND it.is_released=TRUE AND s.is_active=TRUE`, [sale.id],
    )).rows[0].c;
    assert.ok(tvCount > 0);

    const approvedAgain = await changeCommercialQuoteStatus(quote.id, 'approved', user);
    assert.equal(approvedAgain.sale.id, sale.id);
    assert.equal((await client.query('SELECT COUNT(*)::int c FROM commercial_sales WHERE commercial_quote_id=$1', [quote.id])).rows[0].c, 1);
    assert.equal((await client.query('SELECT COUNT(*)::int c FROM internal_orders WHERE commercial_sale_id=$1', [sale.id])).rows[0].c, 1);
    await assert.rejects(updateCommercialQuote(quote.id, { items: [] }, user), (error) => error.code === 'QUOTE_NOT_EDITABLE');

    const listed = await listCommercialSales({ search: String(sale.sale_number) }, client);
    assert.ok(listed.some((item) => item.id === sale.id));
    const countsAfter = (await client.query(`SELECT
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM internal_orders) AS orders,
      (SELECT COUNT(*)::int FROM sold_items) AS sold_items,
      (SELECT COUNT(*)::int FROM internal_tasks) AS tasks,
      (SELECT COUNT(*)::int FROM shipment_volumes) AS volumes,
      (SELECT COUNT(*)::int FROM purchases) AS purchases`)).rows[0];
    assert.equal(countsAfter.products, countsBefore.products);
    assert.equal(countsAfter.orders, countsBefore.orders + 1);
    assert.equal(countsAfter.sold_items, countsBefore.sold_items + 1);
    assert.ok(countsAfter.tasks > countsBefore.tasks);
    assert.equal(countsAfter.volumes, countsBefore.volumes);
    assert.equal(countsAfter.purchases, countsBefore.purchases);
  } finally {
    pool.connect = realConnect;
    await client.query('ROLLBACK');
    await client.query("SELECT setval('commercial_sale_number_seq',$1,$2)", [saleSequenceBefore.last_value, saleSequenceBefore.is_called]);
    client.release();
  }
});

test('falha na criação da Produção reverte aprovação, Venda e Ordem por inteiro', async () => {
  const realConnect = pool.connect.bind(pool);
  const client = await realConnect();
  const saleSequenceBefore = (await client.query('SELECT last_value,is_called FROM commercial_sale_number_seq')).rows[0];
  await client.query('BEGIN');
  let failTasks = false;
  pool.connect = async () => transactionalPoolWrapper(client, (sql) => failTasks && /INSERT INTO internal_tasks/i.test(sql));
  try {
    const ids = await fixture(client);
    const user = { id: ids.user_id, username: 'commercial-sale-rollback-test', permissions: userPermissions };
    const quote = await createCommercialQuote({
      customer_id: ids.customer_id,
      items: [{ product_id: ids.configured_id, quantity: 1, unit_price: '100.00', discount_amount: 0 }],
      payment_methods: [{ method_type: 'pix', calculation_type: 'amount', amount: '100.00' }],
    }, user);
    await changeCommercialQuoteStatus(quote.id, 'sent', user);
    failTasks = true;
    await assert.rejects(changeCommercialQuoteStatus(quote.id, 'approved', user), /falha operacional simulada/);
    failTasks = false;
    const preserved = await getCommercialQuote(quote.id, client);
    assert.equal(preserved.status, 'sent');
    assert.equal(preserved.sale, null);
    assert.equal((await client.query('SELECT COUNT(*)::int c FROM commercial_sales WHERE commercial_quote_id=$1', [quote.id])).rows[0].c, 0);
    assert.equal((await client.query('SELECT COUNT(*)::int c FROM internal_orders WHERE commercial_quote_id=$1', [quote.id])).rows[0].c, 0);
  } finally {
    pool.connect = realConnect;
    await client.query('ROLLBACK');
    await client.query("SELECT setval('commercial_sale_number_seq',$1,$2)", [saleSequenceBefore.last_value, saleSequenceBefore.is_called]);
    client.release();
  }
});

test('duas aprovações simultâneas preservam a unicidade Quote -> Venda', async () => {
  const globalCounterBefore = (await pool.query(
    "SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key='global'",
  )).rows[0].last_value;
  const annualCounterBefore = (await pool.query(
    'SELECT last_value FROM commercial_quote_counters WHERE counter_year=$1', [new Date().getFullYear()],
  )).rows[0]?.last_value;
  const saleSequenceBefore = (await pool.query('SELECT last_value,is_called FROM commercial_sale_number_seq')).rows[0];
  const ids = await fixture();
  const user = { id: ids.user_id, username: 'commercial-sale-concurrency-test', permissions: userPermissions };
  const quote = await createCommercialQuote({
    customer_id: ids.customer_id,
    items: [{ product_id: ids.pending_id, quantity: 1, unit_price: '1.00', discount_amount: 0 }],
    payment_methods: [{ method_type: 'pix', calculation_type: 'amount', amount: '1.00' }],
  }, user);
  try {
    await changeCommercialQuoteStatus(quote.id, 'sent', user);
    const [first, second] = await Promise.all([
      changeCommercialQuoteStatus(quote.id, 'approved', user),
      changeCommercialQuoteStatus(quote.id, 'approved', user),
    ]);
    assert.equal(first.sale.id, second.sale.id);
    assert.equal((await pool.query('SELECT COUNT(*)::int c FROM commercial_sales WHERE commercial_quote_id=$1', [quote.id])).rows[0].c, 1);
    assert.equal((await pool.query('SELECT COUNT(*)::int c FROM internal_orders WHERE commercial_quote_id=$1', [quote.id])).rows[0].c, 0);
  } finally {
    const saleIds = (await pool.query('SELECT id FROM commercial_sales WHERE commercial_quote_id=$1', [quote.id])).rows.map((row) => row.id);
    if (saleIds.length) {
      await pool.query('DELETE FROM audit_logs WHERE entity_id=ANY($1::uuid[])', [saleIds]);
      await pool.query('DELETE FROM commercial_sale_items WHERE commercial_sale_id=ANY($1::uuid[])', [saleIds]);
      await pool.query('DELETE FROM commercial_sales WHERE id=ANY($1::uuid[])', [saleIds]);
    }
    await pool.query('DELETE FROM commercial_quote_documents WHERE commercial_quote_id=$1', [quote.id]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id=$1', [quote.id]);
    await pool.query('DELETE FROM commercial_quotes WHERE id=$1', [quote.id]);
    await pool.query("UPDATE commercial_quote_commercial_counters SET last_value=$1 WHERE counter_key='global'", [globalCounterBefore]);
    if (annualCounterBefore !== undefined) {
      await pool.query('UPDATE commercial_quote_counters SET last_value=$1 WHERE counter_year=$2', [annualCounterBefore, new Date().getFullYear()]);
    }
    await pool.query("SELECT setval('commercial_sale_number_seq',$1,$2)", [saleSequenceBefore.last_value, saleSequenceBefore.is_called]);
  }
});
