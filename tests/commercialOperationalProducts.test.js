import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { pool, transaction } from '../backend/src/database/pool.js';
import {
  ensureCommercialProductOperationalProduct,
  regularizeCommercialProductOperationalLinks,
} from '../backend/src/services/commercialProductOperationalService.js';
import { createCatalog } from '../backend/src/services/productCatalogService.js';

after(async () => pool.end());

const sideEffectTables = [
  'internal_orders', 'sold_items', 'shipment_volumes', 'purchases', 'purchase_items',
  'purchase_requests', 'purchase_quote_requests', 'commercial_quotes', 'commercial_legacy_quotes',
];

async function counts(client, tables = sideEffectTables) {
  const result = {};
  for (const table of tables) result[table] = (await client.query(`SELECT COUNT(*)::int total FROM ${table}`)).rows[0].total;
  return result;
}

async function insertCommercial(client, name, operationalProductId = null, withCatalog = true) {
  const commercial = (await client.query(
    `INSERT INTO commercial_products(name,operational_product_id) VALUES($1,$2) RETURNING *`,
    [name, operationalProductId],
  )).rows[0];
  if (withCatalog) await client.query('INSERT INTO product_catalogs(commercial_product_id) VALUES($1)', [commercial.id]);
  return commercial;
}

test('regularização preserva, reutiliza, cria uma vez e não produz efeitos operacionais', async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const suffix = `${process.pid}-${Date.now()}`;
    const existing = (await client.query(
      `INSERT INTO products(name,type,default_volume_quantity,default_total_weight_kg,is_active,internal_code,review_status,creation_origin)
       VALUES($1,'manufactured',1,1,TRUE,$2,'approved','manual') RETURNING *`,
      [`Produto existente ${suffix}`, `LEGACY-${suffix}`],
    )).rows[0];
    const preserved = await insertCommercial(client, `Produto vinculado ${suffix}`, existing.id);
    const exact = await insertCommercial(client, `  PRODUTO   EXISTENTE ${suffix}  `);
    const missing = await insertCommercial(client, `Produto novo do Comercial ${suffix}`);
    const withoutCatalog = await insertCommercial(client, `Produto sem Catálogo ${suffix}`, null, false);
    const oldCode = existing.internal_code;
    const productsBefore = (await client.query('SELECT COUNT(*)::int total FROM products')).rows[0].total;
    const effectsBefore = await counts(client);

    const preservedResult = await ensureCommercialProductOperationalProduct(client, preserved.id);
    assert.equal(preservedResult.action, 'preserve');
    assert.equal(preservedResult.product.id, existing.id);

    const exactResult = await ensureCommercialProductOperationalProduct(client, exact.id);
    assert.equal(exactResult.action, 'link_existing');
    assert.equal(exactResult.product.id, existing.id);

    const createdResult = await ensureCommercialProductOperationalProduct(client, missing.id);
    assert.equal(createdResult.action, 'create');
    assert.match(createdResult.product.internal_code, /^\d+$/);
    assert.equal(createdResult.product.type, 'manufactured');
    assert.equal(createdResult.product.review_status, 'pending_review');
    assert.equal(createdResult.product.creation_origin, 'commercial');
    assert.equal(createdResult.product.default_volume_quantity, null);
    assert.equal(createdResult.product.default_total_weight_kg, null);
    assert.equal(createdResult.product.operational_cost, null);
    assert.equal(createdResult.product.sector_id, null);

    const repeated = await ensureCommercialProductOperationalProduct(client, missing.id);
    assert.equal(repeated.action, 'preserve');
    assert.equal(repeated.product.id, createdResult.product.id);
    await regularizeCommercialProductOperationalLinks(client, [preserved.id, exact.id, missing.id, withoutCatalog.id]);

    assert.equal((await client.query('SELECT operational_product_id FROM commercial_products WHERE id=$1', [withoutCatalog.id])).rows[0].operational_product_id, null);
    assert.equal((await client.query('SELECT internal_code FROM products WHERE id=$1', [existing.id])).rows[0].internal_code, oldCode);
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM products')).rows[0].total, productsBefore + 1);
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM products WHERE internal_code=$1', [createdResult.product.internal_code])).rows[0].total, 1);
    assert.deepEqual(await counts(client), effectsBefore);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('criação futura de Catálogo garante Produto interno no backend', async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  const actualConnect = pool.connect.bind(pool);
  const actualQuery = pool.query.bind(pool);
  pool.connect = async () => ({
    query: async (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim().toUpperCase()) ? { rows: [], rowCount: 0 } : client.query(sql, params),
    release() {},
  });
  pool.query = (sql, params) => client.query(sql, params);
  try {
    const userId = (await client.query("SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY id LIMIT 1")).rows[0].id;
    const commercial = await insertCommercial(client, `Catálogo futuro ${process.pid}-${Date.now()}`, null, false);
    const effectsBefore = await counts(client);
    const catalog = await createCatalog({
      commercial_product_id: commercial.id,
      manufacturing_sector_id: (await client.query('SELECT id FROM sectors WHERE is_active LIMIT 1')).rows[0].id,
      version: { commercial_title: commercial.name, specifications: [], included_items: [] },
    }, { id: userId, permissions: ['commercial.catalog.create'] });
    assert.ok(catalog.operational_product_id);
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM products WHERE id=$1', [catalog.operational_product_id])).rows[0].total, 1);
    assert.deepEqual(await counts(client), effectsBefore);
  } finally {
    pool.connect = actualConnect;
    pool.query = actualQuery;
    await client.query('ROLLBACK');
    client.release();
  }
});

test('duas transações concorrentes não criam dois Produtos para o mesmo Catálogo', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const commercial = await insertCommercial(pool, `Concorrência Comercial ${suffix}`);
  let productId;
  try {
    const results = await Promise.all([
      transaction((client) => ensureCommercialProductOperationalProduct(client, commercial.id)),
      transaction((client) => ensureCommercialProductOperationalProduct(client, commercial.id)),
    ]);
    productId = results[0].product.id;
    assert.equal(results[1].product.id, productId);
    assert.equal((await pool.query('SELECT COUNT(*)::int total FROM products WHERE name=$1', [commercial.name])).rows[0].total, 1);
    assert.equal((await pool.query('SELECT operational_product_id FROM commercial_products WHERE id=$1', [commercial.id])).rows[0].operational_product_id, productId);
  } finally {
    await pool.query('DELETE FROM product_catalogs WHERE commercial_product_id=$1', [commercial.id]);
    await pool.query('DELETE FROM commercial_products WHERE id=$1', [commercial.id]);
    if (productId) await pool.query('DELETE FROM products WHERE id=$1', [productId]);
  }
});
