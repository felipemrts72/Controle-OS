import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pool } from '../backend/src/database/pool.js';
import {
  calculateSop,
  createCatalog,
  createCommercialProduct,
  createCatalogVersion,
  getCatalogByCommercialProduct,
  getCatalogByProduct,
  publishCatalogVersion,
  updateCatalog,
  updateCommercialProduct,
  updateCatalogVersion,
} from '../backend/src/services/productCatalogService.js';
import { createCommercialQuote, getCommercialQuote, searchCommercialQuoteProducts } from '../backend/src/services/commercialQuoteService.js';
import { buildQuoteDocumentData } from '../backend/src/services/commercialQuoteDocumentDataService.js';
import { requirePermission } from '../backend/src/middlewares/authMiddleware.js';
import { listProducts, saveProduct } from '../backend/src/controllers/basicControllers.js';

after(async () => pool.end());

const permissions = [
  'commercial.catalog.view', 'commercial.catalog.create', 'commercial.catalog.edit',
  'commercial.catalog.sop.view', 'commercial.catalog.sop.edit', 'commercial.catalog.publish',
  'commercial.quotes.view', 'commercial.quotes.create', 'commercial.quotes.edit',
];

test('SOP suporta valor ou percentual sem ambiguidade', () => {
  assert.equal(calculateSop('100000.00', 'amount', '8000.00').minimum_price, '92000.00');
  assert.equal(calculateSop('100000.00', 'percentage', '8.00').minimum_price, '92000.00');
  assert.equal(calculateSop('100000.00', null, null), null);
});

test('migration preserva estruturas operacionais e mantém perfil comercial legado', () => {
  const sql = fs.readFileSync(new URL('../database/migrations/20260818_commercial_catalog.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS operational_cost/);
  assert.match(sql, /FROM product_commercial_profiles/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /DELETE FROM role_permissions/i);
  assert.match(sql, /ON DELETE RESTRICT/);
});

test('RBAC separa Catálogo, SOP e custo e não concede Comercial por atalhos', () => {
  const run = (permission, granted) => {
    let result;
    requirePermission(permission)({ user: { username: 'synthetic', permissions: granted } }, {}, (error) => { result = error || null; });
    return result;
  };
  assert.equal(run('commercial.catalog.view', ['commercial.catalog.view']), null);
  assert.equal(run('commercial.catalog.sop.edit', ['commercial.catalog.edit'])?.status, 403);
  assert.equal(run('products.cost.view', ['products.view'])?.status, 403);
});

test('Produto Comercial é independente, aceita vínculo opcional e centraliza Catálogo, snapshots e item manual', async () => {
  const fixture = (await pool.query(`SELECT
    (SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY id LIMIT 1) user_id,
    (SELECT id FROM products WHERE is_active=TRUE ORDER BY id LIMIT 1) product_id`)).rows[0];
  assert.ok(fixture.user_id && fixture.product_id);
  const user = { id: fixture.user_id, username: 'synthetic', permissions };
  const actualConnect = pool.connect.bind(pool);
  const actualQuery = pool.query.bind(pool);
  const client = await actualConnect();
  await client.query('BEGIN');
  pool.connect = async () => ({ query: async (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim().toUpperCase()) ? { rows: [], rowCount: 0 } : client.query(sql, params), release() {} });
  pool.query = (sql, params) => client.query(sql, params);
  const suffix = `${process.pid}-${Date.now()}`;
  try {
    const created = await createCommercialProduct({ name: `Moinho Comercial ${suffix}`, commercial_code: `MC-${suffix}` }, user);
    assert.ok(created.commercial_product_id);
    assert.equal(created.operational_product_id, null);
    assert.equal(created.reference_price, null);
    assert.equal(created.configured, false);
    assert.equal(created.catalog_configured, false);

    const linked = await updateCommercialProduct(created.commercial_product_id, {
      name: created.product_name, commercial_code: created.commercial_code,
      commercial_description: 'Descrição bonita e técnica', operational_product_id: fixture.product_id,
      reference_price: '', sop_discount_type: null, sop_discount_value: null, is_active: true,
    }, user);
    assert.equal(linked.operational_product_id, fixture.product_id);
    assert.equal(linked.reference_price, null);
    assert.equal(linked.catalog_configured, false);

    const unlinked = await updateCommercialProduct(created.commercial_product_id, {
      name: created.product_name, commercial_code: created.commercial_code,
      commercial_description: 'Descrição bonita e técnica', operational_product_id: null,
      reference_price: '50000.00', sop_discount_type: 'percentage', sop_discount_value: '5', is_active: true,
    }, user);
    assert.equal(unlinked.operational_product_id, null);
    assert.equal(unlinked.sop_minimum_price, '47500.00');

    const technical = await createCatalog({
      commercial_product_id: created.commercial_product_id, reference_price: '50000.00',
      commercial_description: 'Descrição bonita e técnica', sop_discount_type: 'percentage', sop_discount_value: '5',
      version: { commercial_title: `Moinho Comercial ${suffix}`, specifications: [], included_items: [] },
    }, user);
    assert.equal(technical.catalog_configured, true);
    assert.equal(technical.versions.length, 1);

    const quote = await createCommercialQuote({ items: [{ commercial_product_id: created.commercial_product_id, quantity: 1, unit_price: '49000.00' }] }, user);
    assert.equal(quote.items[0].commercial_product_id, created.commercial_product_id);
    assert.equal(quote.items[0].commercial_product_name_snapshot, `Moinho Comercial ${suffix}`);
    assert.equal(quote.items[0].product_id, null);
    assert.equal(quote.items[0].reference_price_snapshot, '50000.00');
    const snapshotName = quote.items[0].commercial_product_name_snapshot;
    await updateCommercialProduct(created.commercial_product_id, { ...unlinked, name: `Nome alterado ${suffix}` }, user);
    const historical = await getCommercialQuote(quote.id, client);
    assert.equal(historical.items[0].commercial_product_name_snapshot, snapshotName);
    assert.equal(buildQuoteDocumentData(historical).items[0].name, snapshotName);

    const commercialCount = (await client.query('SELECT COUNT(*)::int total FROM commercial_products')).rows[0].total;
    const manualOnly = await createCommercialQuote({ items: [{ name: `Serviço único ${suffix}`, quantity: 1, unit_price: 100, save_product: false }] }, user);
    assert.equal(manualOnly.items[0].item_type, 'manual');
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM commercial_products')).rows[0].total, commercialCount);
    const saved = await createCommercialQuote({ items: [{ name: `Produto salvo ${suffix}`, code: 'NOVO', quantity: 1, unit_price: 120, save_product: true }] }, user);
    assert.ok(saved.items[0].commercial_product_id);
    assert.equal(saved.items[0].product_id, null);
    assert.equal((await client.query('SELECT COUNT(*)::int total FROM products WHERE name=$1', [`Produto salvo ${suffix}`])).rows[0].total, 0);
    await assert.rejects(
      createCommercialQuote({ items: [{ name: `Produto salvo ${suffix}`, quantity: 1, unit_price: 120, save_product: true }] }, user),
      (error) => Boolean(error.status === 409 && error.code === 'COMMERCIAL_PRODUCT_DUPLICATE' && error.details?.duplicate?.id),
    );

    const search = await searchCommercialQuoteProducts(`Nome alterado ${suffix}`, user);
    assert.equal(search[0].origin_type, 'commercial');
    assert.equal(search[0].commercial_product_id, created.commercial_product_id);

    const inactive = await updateCommercialProduct(created.commercial_product_id, { ...unlinked, name: `Nome alterado ${suffix}`, is_active: false }, user);
    assert.equal(inactive.is_active, false);
    const loaded = await getCatalogByCommercialProduct(created.commercial_product_id, user, client);
    assert.equal(loaded.is_active, false);
  } finally {
    pool.connect = actualConnect;
    pool.query = actualQuery;
    await client.query('ROLLBACK');
    client.release();
  }
});

test('cadastro operacional exige custo de quem pode editá-lo e não o expõe sem products.cost.view', async () => {
  const fixture = (await pool.query(`SELECT
    (SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY id LIMIT 1) user_id,
    (SELECT id FROM sectors WHERE is_active=TRUE ORDER BY id LIMIT 1) sector_id,
    (SELECT code FROM product_types WHERE is_active=TRUE ORDER BY CASE WHEN code='resale' THEN 0 ELSE 1 END,code LIMIT 1) type`)).rows[0];
  const actualConnect = pool.connect.bind(pool);
  const client = await actualConnect();
  await client.query('BEGIN');
  pool.connect = async () => ({ query: async (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim().toUpperCase()) ? { rows: [], rowCount: 0 } : client.query(sql, params), release() {} });
  const user = { id: fixture.user_id, username: 'synthetic', permissions: ['products.create', 'products.cost.edit', 'products.cost.view'] };
  const payload = { name: `Produto custo ${Date.now()}`, type: fixture.type, sector_id: fixture.sector_id, measurement_unit_code: 'UN', default_volume_quantity: 1, default_total_weight_kg: 1, components: [] };
  const invoke = (body, requestUser = user) => new Promise((resolve) => saveProduct(
    { params: {}, body, user: requestUser },
    { status(status) { this.statusCode = status; return this; }, json(value) { resolve({ status: this.statusCode, body: value }); } },
    (error) => resolve({ error }),
  ));
  try {
    const missing = await invoke(payload);
    assert.equal(missing.error?.code, 'PRODUCT_OPERATIONAL_COST_REQUIRED');
    const created = await invoke({ ...payload, operational_cost: '40000.00' });
    assert.equal(created.status, 201);
    assert.equal(created.body.operational_cost, '40000.00');

  } finally {
    pool.connect = actualConnect;
    await client.query('ROLLBACK');
    client.release();
  }
  const list = (requestUser) => new Promise((resolve, reject) => listProducts({ query: { paginated: 'true', limit: 1 }, user: requestUser }, { json: resolve }, reject));
  const visible = await list(user);
  const hidden = await list({ id: fixture.user_id, username: 'synthetic', permissions: ['products.view'] });
  assert.equal(Object.hasOwn(visible.items[0], 'operational_cost'), true);
  assert.equal(Object.hasOwn(hidden.items[0], 'operational_cost'), false);
});

test('Catálogo versionado alimenta snapshot e alteração futura da SOP não muda Orçamento', async () => {
  const fixture = (await pool.query(`SELECT
    (SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY id LIMIT 1) user_id,
    (SELECT id FROM customers WHERE is_active=TRUE ORDER BY id LIMIT 1) customer_id,
    (SELECT p.id FROM products p LEFT JOIN product_catalogs c ON c.product_id=p.id WHERE p.is_active=TRUE AND c.id IS NULL ORDER BY p.id LIMIT 1) product_id`)).rows[0];
  assert.ok(fixture.user_id && fixture.customer_id && fixture.product_id, 'requer Produto sem Catálogo, Cliente e usuário ativos');
  const user = { id: fixture.user_id, username: 'synthetic', permissions };

  const actualConnect = pool.connect.bind(pool);
  const client = await actualConnect();
  await client.query('BEGIN');
  pool.connect = async () => ({
    query: async (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim().toUpperCase()) ? { rows: [], rowCount: 0 } : client.query(sql, params),
    release() {},
  });
  try {
    const noCatalogQuote = await createCommercialQuote({
      customer_id: fixture.customer_id, quote_date: '2026-08-18',
      items: [{ product_id: fixture.product_id, quantity: 1, unit_price: 123, discount_amount: 0 }],
    }, user);
    assert.equal(noCatalogQuote.items[0].product_catalog_id, null);
    assert.equal(noCatalogQuote.items[0].is_outside_sop, false);

    const created = await createCatalog({
      product_id: fixture.product_id,
      reference_price: '100000.00', commercial_description: 'Descrição comercial H-6',
      sop_discount_type: 'amount', sop_discount_value: '8000.00',
      version: {
        commercial_title: 'Moinho H-6', presentation_text: 'Apresentação comercial',
        specifications: [{ name: 'Capacidade', value: '6', unit: 't/h' }],
        included_items: [{ description: 'Painel elétrico', quantity: 1, unit: 'UN' }],
      },
    }, user);
    assert.equal(created.sop_minimum_price, '92000.00');
    assert.equal(created.versions[0].status, 'draft');
    assert.equal(created.versions[0].specifications[0].name, 'Capacidade');

    const draft = created.versions[0];
    await updateCatalogVersion(draft.id, { ...draft, commercial_title: 'Moinho H-6 revisado' }, user);
    const published = await publishCatalogVersion(draft.id, user);
    assert.equal(published.active_version_id, draft.id);
    assert.equal(published.versions.find((item) => item.id === draft.id).status, 'published');
    await assert.rejects(updateCatalogVersion(draft.id, draft, user), (error) => error.status === 409 && error.code === 'CATALOG_VERSION_IMMUTABLE');

    const quote = await createCommercialQuote({
      customer_id: fixture.customer_id, quote_date: '2026-08-18',
      items: [{ product_id: fixture.product_id, quantity: 1, unit_price: '88000.00', discount_amount: 0 }],
    }, user);
    assert.equal(quote.items[0].reference_price_snapshot, '100000.00');
    assert.equal(quote.items[0].sop_minimum_price_snapshot, '92000.00');
    assert.equal(quote.items[0].is_outside_sop, true);
    assert.equal(quote.items[0].product_catalog_version_id, draft.id);

    await updateCatalog(created.id, { reference_price: '100000.00', commercial_description: 'Nova descrição', sop_discount_type: 'amount', sop_discount_value: '20000.00' }, user);
    const historical = await getCommercialQuote(quote.id, client);
    assert.equal(historical.items[0].sop_discount_value_snapshot, '8000.0000');
    assert.equal(historical.items[0].sop_minimum_price_snapshot, '92000.00');
    assert.equal(historical.items[0].is_outside_sop, true);

    const nextVersion = await createCatalogVersion(created.id, user);
    assert.equal(nextVersion.versions[0].version_number, 2);
    assert.equal(nextVersion.versions[0].status, 'draft');
    const detail = await getCatalogByProduct(fixture.product_id, user, client);
    assert.equal(detail.versions.length, 2);
  } finally {
    pool.connect = actualConnect;
    await client.query('ROLLBACK');
    client.release();
  }
});

test('Admin possui catálogo e custo; Estoquista não recebeu Comercial automaticamente', async () => {
  const rows = await pool.query(`SELECT r.slug,ARRAY_REMOVE(ARRAY_AGG(p.code),NULL) permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE r.slug IN ('admin','estoquista') GROUP BY r.id,r.slug`);
  const byRole = Object.fromEntries(rows.rows.map((row) => [row.slug, row.permissions]));
  permissions.slice(0, 6).forEach((permission) => assert.ok(byRole.admin.includes(permission), permission));
  assert.ok(byRole.admin.includes('products.cost.view'));
  assert.ok(byRole.estoquista.includes('products.cost.view'));
  assert.ok(byRole.estoquista.includes('products.cost.edit'));
  assert.equal(byRole.estoquista.some((permission) => permission.startsWith('commercial.catalog.')), false);
});
