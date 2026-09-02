import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import { createInternalOrder, searchCustomers } from '../backend/src/services/orderService.js';
import { updateInternalOrder } from '../backend/src/controllers/internalOrderController.js';

after(async () => pool.end());

test('criação e edição de Produção preservam cliente, item, tarefa e volume', async () => {
  const suffix = randomUUID().slice(0, 8);
  const productId = randomUUID();
  const customerName = `Cliente regressão ${suffix}`;
  const saleNumber = `REG-${suffix}`;
  const [userResult, sectorResult, existingCustomerResult] = await Promise.all([
    pool.query(`SELECT id FROM users WHERE is_active = TRUE AND approval_status = 'approved' ORDER BY id LIMIT 1`),
    pool.query(`SELECT id FROM sectors WHERE is_active = TRUE AND slug <> 'expedicao' ORDER BY id LIMIT 1`),
    pool.query(`SELECT name FROM customers WHERE LENGTH(BTRIM(name)) >= 2 ORDER BY updated_at DESC LIMIT 1`),
  ]);
  const userId = userResult.rows[0]?.id;
  const sectorId = sectorResult.rows[0]?.id;
  assert.ok(userId && sectorId, 'a regressão requer usuário e setor ativos');

  if (existingCustomerResult.rows[0]) {
    const savedName = existingCustomerResult.rows[0].name;
    const autocomplete = await searchCustomers(savedName.slice(0, Math.max(2, Math.min(8, savedName.length))));
    assert.ok(autocomplete.some((customer) => customer.name === savedName));
    assert.ok(autocomplete.every((customer) => Object.hasOwn(customer, 'location') && Object.hasOwn(customer, 'carrier_name')));
  }

  const realConnect = pool.connect.bind(pool);
  const client = await realConnect();
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO products (
      id, name, type, sector_id, default_volume_quantity, default_total_weight_kg,
      is_active, measurement_unit_code, review_status, creation_origin
     ) VALUES ($1, $2, 'manufactured', $3, 2, 4, TRUE, 'UN', 'approved', 'manual')`,
    [productId, `Produto regressão ${suffix}`, sectorId],
  );

  const wrapper = {
    async query(text, params) {
      const command = typeof text === 'string' ? text.trim().toUpperCase() : '';
      if (command === 'BEGIN' || command === 'COMMIT') return { rows: [], rowCount: 0 };
      if (command === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return client.query(text, params);
    },
    release() {},
  };
  pool.connect = async () => wrapper;

  try {
    const created = await createInternalOrder({
      sale_number: saleNumber,
      customer_name: customerName,
      customer_phone: '(66) 99999-0000',
      promised_date: '2026-12-10',
      delivery_type: 'transportadora',
      carrier_name: 'Transportadora regressão',
      destination_city: 'Sinop',
      destination_uf: 'mt',
      items: [{ product_id: productId, quantity: 1, is_spare_part: false }],
    }, userId);

    const customer = (await client.query('SELECT * FROM customers WHERE id = $1', [created.customer_id])).rows[0];
    const item = (await client.query('SELECT * FROM sold_items WHERE internal_order_id = $1', [created.id])).rows[0];
    const tasks = (await client.query('SELECT * FROM internal_tasks WHERE sold_item_id = $1 ORDER BY id', [item.id])).rows;
    const volumes = (await client.query('SELECT * FROM shipment_volumes WHERE sold_item_id = $1 ORDER BY volume_number', [item.id])).rows;

    assert.equal(customer.name, customerName);
    assert.equal(customer.location, 'Sinop');
    assert.equal(customer.destination_uf, 'MT');
    assert.equal(item.product_id, productId);
    assert.equal(tasks.length, 1);
    assert.equal(volumes.length, 2);
    assert.equal(volumes.every((volume) => Number(volume.weight_kg) === 2), true);

    let responseBody;
    let responseError;
    await updateInternalOrder({
      params: { id: created.id },
      user: { id: userId },
      body: {
        sale_number: saleNumber,
        customer_id: customer.id,
        customer_name: customerName,
        customer_phone: '(66) 98888-0000',
        promised_date: '2026-12-12',
        delivery_type: 'transportadora',
        carrier_name: 'Transportadora regressão',
        destination_city: 'Sorriso',
        destination_uf: 'MT',
        items: [{ id: item.id, product_id: productId, quantity: 1, is_spare_part: false }],
        volumes: volumes.map((volume) => ({
          id: volume.id,
          sold_item_id: volume.sold_item_id,
          volume_number: volume.volume_number,
          total_volumes: volume.total_volumes,
          weight_kg: volume.weight_kg,
          description: volume.description,
          label_status: volume.label_status,
        })),
      },
    }, { json(value) { responseBody = value; } }, (error) => { responseError = error; });
    if (responseError) throw responseError;

    const updatedCustomer = (await client.query('SELECT * FROM customers WHERE id = $1', [customer.id])).rows[0];
    const updatedOrder = (await client.query('SELECT * FROM internal_orders WHERE id = $1', [created.id])).rows[0];
    const identityCounts = (await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM customers WHERE normalized_name = $1) AS customers,
        (SELECT COUNT(*)::int FROM sold_items WHERE internal_order_id = $2) AS items,
        (SELECT COUNT(*)::int FROM internal_tasks WHERE sold_item_id = $3) AS tasks,
        (SELECT COUNT(*)::int FROM shipment_volumes WHERE sold_item_id = $3) AS volumes`,
      [customerName.toLowerCase(), created.id, item.id],
    )).rows[0];

    assert.equal(responseBody.id, created.id);
    assert.equal(updatedOrder.customer_id, customer.id);
    assert.equal(updatedOrder.customer_name, customerName);
    assert.equal(updatedOrder.customer_phone, '(66) 98888-0000');
    assert.equal(updatedCustomer.phone, '(66) 98888-0000');
    assert.equal(updatedCustomer.location, 'Sorriso');
    assert.deepEqual(identityCounts, { customers: 1, items: 1, tasks: 1, volumes: 2 });
  } finally {
    pool.connect = realConnect;
    await client.query('ROLLBACK');
    client.release();
  }

  const persisted = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM products WHERE id = $1', [productId]),
    pool.query('SELECT COUNT(*)::int AS count FROM internal_orders WHERE sale_number = $1', [saleNumber]),
    pool.query('SELECT COUNT(*)::int AS count FROM customers WHERE normalized_name = $1', [customerName.toLowerCase()]),
  ]);
  assert.deepEqual(persisted.map((result) => result.rows[0].count), [0, 0, 0]);
});
