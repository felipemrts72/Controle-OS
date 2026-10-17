import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../backend/src/database/pool.js';
import { createQuickOperationalProduct } from '../backend/src/services/commercialProductOperationalService.js';
after(() => pool.end());

test('cadastro rápido usa setor real, vincula e mantém zero efeitos operacionais', async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const user = (await client.query('SELECT id FROM users LIMIT 1')).rows[0];
    const sector = (await client.query('SELECT id FROM sectors WHERE is_active LIMIT 1')).rows[0];
    const cp = (await client.query("INSERT INTO commercial_products(name) VALUES('Teste rápido rollback') RETURNING id")).rows[0];
    const tables = ['internal_orders', 'sold_items', 'shipment_volumes', 'product_components', 'stock_movements'];
    const existing = [];
    for (const table of tables) if ((await client.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) existing.push(table);
    const counts = async () => Object.fromEntries(await Promise.all(existing.map(async (table) => [table, (await client.query(`SELECT count(*)::int total FROM ${table}`)).rows[0].total])));
    const before = await counts();
    const p = await createQuickOperationalProduct(client, { name: 'Teste rápido rollback', sector_id: sector.id, commercial_product_id: cp.id }, user);
    assert.equal(p.sector_id, sector.id);
    assert.equal(p.review_status, 'pending_review');
    assert.equal(p.creation_origin, 'commercial');
    assert.equal(p.operational_cost, null);
    assert.equal((await client.query('SELECT operational_product_id FROM commercial_products WHERE id=$1', [cp.id])).rows[0].operational_product_id, p.id);
    assert.deepEqual(await counts(), before);
    assert.equal((await client.query('SELECT count(*)::int total FROM product_components WHERE product_id=$1', [p.id])).rows[0].total, 0);
  } finally { await client.query('ROLLBACK'); client.release(); }
});
