import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import { createCatalog, createCommercialProduct, getCatalogByCommercialProduct, listCatalogs } from '../backend/src/services/productCatalogService.js';
import { createQuickOperationalProduct } from '../backend/src/services/commercialProductOperationalService.js';

after(() => pool.end());

// Exercise real SQL and transaction rollback without committing fixture data.
async function isolated(run) {
  const connect = pool.connect.bind(pool), query = pool.query.bind(pool);
  const client = await connect();
  await client.query('BEGIN');
  pool.query = (sql, args) => client.query(sql, args);
  pool.connect = async () => ({
    query: (sql, args) => client.query(({ BEGIN: 'SAVEPOINT service', COMMIT: 'RELEASE SAVEPOINT service', ROLLBACK: 'ROLLBACK TO SAVEPOINT service' })[sql] || sql, args),
    release() {},
  });
  try {
    const user = { id: (await client.query('SELECT id FROM users WHERE is_active LIMIT 1')).rows[0].id, permissions: [] };
    const sector = (await client.query('SELECT id FROM sectors WHERE is_active LIMIT 1')).rows[0];
    await run(client, user, sector);
  } finally {
    pool.connect = connect; pool.query = query;
    await client.query('ROLLBACK'); client.release();
  }
}

test('cadastro direto retorna número imediatamente, preço não cria gêmeo, duplicação recebe menor livre', () => isolated(async (c, user) => {
  const original = (await c.query('SELECT id,commercial_number,commercial_code FROM commercial_products ORDER BY id')).rows;
  const first = await createCommercialProduct({ name: `Direto ${randomUUID()}`, reference_price: 10 }, user);
  assert.ok(BigInt(first.commercial_number) > 0n);
  assert.equal(first.operational_product_id, null);
  assert.equal(first.catalog_configured, false);
  const copy = await createCommercialProduct({ ...first, name: `Cópia ${randomUUID()}`, commercial_number: first.commercial_number, commercial_code: null }, user);
  assert.notEqual(copy.commercial_number, first.commercial_number);
  const hole = (await c.query("INSERT INTO commercial_products(name) VALUES('Lacuna de teste') RETURNING *")).rows[0];
  await c.query("INSERT INTO commercial_products(name) VALUES('Depois da lacuna')");
  await c.query('DELETE FROM commercial_products WHERE id=$1', [hole.id]);
  const filled = (await c.query("INSERT INTO commercial_products(name) VALUES('Lacuna preenchida') RETURNING *")).rows[0];
  assert.equal(filled.commercial_number, hole.commercial_number);
  assert.deepEqual((await c.query('SELECT id,commercial_number,commercial_code FROM commercial_products WHERE id=ANY($1::uuid[]) ORDER BY id', [original.map(p => p.id)])).rows, original);
}));

test('ordenação numérica global ASC/DESC antes da paginação, junto a busca e filtros', () => isolated(async (c, user) => {
  const tag = `Ordem ${randomUUID()}`;
  for (const number of [9000, 10000, 10001]) await c.query('INSERT INTO commercial_products(name,commercial_number) VALUES($1,$2)', [tag, number]);
  for (const [sort, expected] of [['code_asc', [9000, 10000, 10001]], ['code_desc', [10001, 10000, 9000]]]) {
    for (let page = 1; page <= 3; page++) {
      const result = await listCatalogs({ search: tag, configured: 'no', status: 'active', sort, page, limit: 1 }, user);
      assert.equal(Number(result.items[0].commercial_number), expected[page - 1]);
      assert.equal(result.pagination.total, 3);
    }
    const global = await listCatalogs({ sort, status: 'all', limit: 1 }, user);
    const aggregate = sort === 'code_asc' ? 'min' : 'max';
    assert.equal(global.items[0].commercial_number, (await c.query(`SELECT ${aggregate}(commercial_number) n FROM commercial_products`)).rows[0].n);
  }
  const codeSearch = await listCatalogs({ search: '10001' }, user);
  assert.ok(codeSearch.items.some(p => p.commercial_number === '10001'));
  await assert.rejects(listCatalogs({ sort: 'commercial_number; DROP TABLE products' }, user), e => e.status === 400);
}));

test('gêmeo exige setor válido, rollback remove órfão, persiste vínculo e não cria efeitos operacionais', () => isolated(async (c, user, sector) => {
  const effectTables = ['internal_orders', 'internal_tasks', 'sold_items', 'shipment_volumes', 'purchases', 'purchase_items'];
  const counts = async () => Object.fromEntries(await Promise.all(effectTables.map(async table => [table, (await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n])));
  const beforeEffects = await counts();
  const cp = await createCommercialProduct({ name: `Gêmeo ${randomUUID()}` }, user);
  const payload = { commercial_product_id: cp.commercial_product_id, manufacturing_sector_id: sector.id };
  await assert.rejects(createCatalog({ ...payload, manufacturing_sector_id: null }, user), e => e.status === 400);
  await assert.rejects(createCatalog({ ...payload, manufacturing_sector_id: randomUUID() }, user), e => e.status === 400);
  await assert.rejects(createCatalog({ ...payload, version: { specifications: [{ name: '', value: '' }] } }, user), e => e.status === 400);
  assert.equal((await c.query('SELECT count(*)::int n FROM products WHERE name=$1', [cp.product_name])).rows[0].n, 0);
  assert.equal((await getCatalogByCommercialProduct(cp.commercial_product_id, user)).operational_product_id, null);
  const saved = await createCatalog(payload, user);
  const product = (await c.query('SELECT * FROM products WHERE id=$1', [saved.operational_product_id])).rows[0];
  assert.equal(product.name, cp.product_name);
  assert.equal(product.type, 'manufactured');
  assert.equal(product.sector_id, sector.id);
  assert.equal(product.review_status, 'pending_review');
  for (const field of ['operational_cost', 'default_total_weight_kg', 'default_volume_quantity', 'measurement_unit_code']) assert.equal(product[field], null, field);
  assert.equal((await getCatalogByCommercialProduct(cp.commercial_product_id, user)).operational_product_id, product.id);
  const refs = (await c.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='product_id' AND table_name<>'product_catalogs'")).rows;
  for (const { table_name: table } of refs) {
    assert.match(table, /^[a-z_]+$/);
    assert.equal((await c.query(`SELECT count(*)::int n FROM ${table} WHERE product_id=$1`, [product.id])).rows[0].n, 0, table);
  }
  const quick = await createQuickOperationalProduct(c, { name: cp.product_name, sector_id: sector.id, commercial_product_id: cp.commercial_product_id }, user);
  assert.equal(quick.id, product.id);
  await assert.rejects(createCatalog(payload, user), e => e.status === 409);
  assert.equal((await c.query('SELECT count(*)::int n FROM products WHERE name=$1', [cp.product_name])).rows[0].n, 1);
  assert.deepEqual(await counts(), beforeEffects);
}));

test('nome igual requer escolha; existente mantém configurações e novo exige confirmação explícita', () => isolated(async (c, user, sector) => {
  const name = `Nome igual ${randomUUID()}`;
  const existing = await createQuickOperationalProduct(c, { name, sector_id: sector.id }, user);
  const cp = await createCommercialProduct({ name }, user);
  const payload = { commercial_product_id: cp.commercial_product_id, manufacturing_sector_id: sector.id };
  await assert.rejects(createCatalog(payload, user), e => e.code === 'OPERATIONAL_PRODUCT_NAME_EXISTS' && e.details.candidates[0].id === existing.id);
  const selected = await createCatalog({ ...payload, operational_product_id: existing.id, manufacturing_sector_id: null }, user);
  assert.equal(selected.operational_product_id, existing.id);
  assert.deepEqual((await c.query('SELECT * FROM products WHERE id=$1', [existing.id])).rows[0], existing);
  assert.equal((await c.query('SELECT count(*)::int n FROM products WHERE name=$1', [name])).rows[0].n, 1);
  const secondName = `Outra igualdade ${randomUUID()}`;
  const other = await createQuickOperationalProduct(c, { name: secondName, sector_id: sector.id }, user);
  const second = await createCommercialProduct({ name: secondName }, user);
  const confirmed = await createCatalog({ ...payload, commercial_product_id: second.commercial_product_id, allow_duplicate_operational_product: true }, user);
  assert.notEqual(confirmed.operational_product_id, other.id);
}));

test('duas criações reais simultâneas deixam um Catálogo e um gêmeo', async () => {
  const user = { id: (await pool.query('SELECT id FROM users WHERE is_active LIMIT 1')).rows[0].id, permissions: [] };
  const sector = (await pool.query('SELECT id FROM sectors WHERE is_active LIMIT 1')).rows[0];
  const cp = await createCommercialProduct({ name: `Concorrência gêmeo ${randomUUID()}` }, user);
  let productId, catalogId, versionIds = [];
  try {
    const results = await Promise.allSettled([1, 2].map(() => createCatalog({ commercial_product_id: cp.commercial_product_id, manufacturing_sector_id: sector.id }, user)));
    const saved = results.find(r => r.status === 'fulfilled')?.value;
    productId = saved?.operational_product_id; catalogId = saved?.id; versionIds = saved?.versions.map(v => v.id) || [];
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
    assert.equal((await pool.query('SELECT count(*)::int n FROM products WHERE name=$1', [cp.product_name])).rows[0].n, 1);
  } finally {
    const loaded = await getCatalogByCommercialProduct(cp.commercial_product_id, user);
    productId ||= loaded.operational_product_id; catalogId ||= loaded.id;
    await pool.query('DELETE FROM audit_logs WHERE entity_id=ANY($1::uuid[])', [[cp.commercial_product_id, productId, catalogId, ...versionIds].filter(Boolean)]);
    if (catalogId) {
      await pool.query('DELETE FROM product_catalog_versions WHERE product_catalog_id=$1', [catalogId]);
      await pool.query('DELETE FROM product_catalogs WHERE id=$1', [catalogId]);
    }
    await pool.query('DELETE FROM commercial_products WHERE id=$1', [cp.commercial_product_id]);
    if (productId) await pool.query('DELETE FROM products WHERE id=$1', [productId]);
  }
});
