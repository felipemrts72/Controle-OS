import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/database/pool.js';
import { buildAuthUser } from '../backend/src/services/permissionService.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/Win%2010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const host = 'https://os.torneadorauniversal.com.br';
const output = 'tmp/catalog-consolidation';
const commercialIds = [], productIds = [];
let browser, page;
const report = {};
try {
  await fs.mkdir(output, { recursive: true });
  const admin = (await pool.query("SELECT u.*,r.slug role_slug FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.is_active AND u.approval_status='approved' LIMIT 1")).rows[0];
  const user = await buildAuthUser(admin);
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '10m' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const create = async (name) => {
    const r = await fetch(`${host}/api/commercial/catalog/products`, { method: 'POST', headers, body: JSON.stringify({ name }) });
    assert.equal(r.status, 201);
    const cp = await r.json(); commercialIds.push(cp.commercial_product_id);
    assert.ok(BigInt(cp.commercial_number) > 0n); assert.equal(cp.operational_product_id, null);
    return cp;
  };
  const cp = await create(`Validação automática ${Date.now()}`);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  page.on('pageerror', error => console.log('pageerror', error.message));
  page.on('response', response => { if (response.status() >= 400) console.log('HTTP', response.status(), response.url()); });
  await page.addInitScript(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }, { token, user });
  const open = async (id) => { await page.goto(`${host}/comercial/catalogo/${id}`); await page.getByLabel('Nome comercial *', { exact: true }).waitFor(); };
  await open(cp.commercial_product_id);
  const sector = page.getByLabel('Setor responsável pela fabricação');
  const solda = (await pool.query("SELECT id FROM sectors WHERE is_active AND lower(btrim(name))='solda'")).rows;
  await sector.locator('option').nth(1).waitFor({ state: 'attached' });
  assert.equal(await sector.inputValue(), solda.length === 1 ? solda[0].id : '');
  report.realSoldaDefault = true;
  const sectorRoute = '**/api/commercial/catalog/manufacturing-sectors';
  await page.route(sectorRoute, async route => {
    const response = await route.fetch();
    const data = (await response.json()).filter(s => s.name.trim().toLowerCase() !== 'solda');
    await route.fulfill({ response, json: data });
  });
  await open(cp.commercial_product_id);
  await sector.locator('option').nth(1).waitFor({ state: 'attached' });
  assert.equal(await sector.inputValue(), '');
  assert.equal(await sector.evaluate(element => element.validity.valueMissing), true);
  report.missingSoldaRequiresSelection = true;
  await page.unroute(sectorRoute);
  await open(cp.commercial_product_id);
  await sector.locator('option').nth(1).waitFor({ state: 'attached' });
  if (!solda.length) await sector.selectOption({ index: 1 });
  const selectedSector = await sector.inputValue();
  await page.getByLabel('01 — Título comercial').fill(cp.product_name);
  const savedResponse = page.waitForResponse(r => r.url().endsWith('/api/commercial/catalog') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar primeira versão', exact: true }).click();
  const saved = await savedResponse;
  assert.equal(saved.status(), 201);
  const catalog = await saved.json(); productIds.push(catalog.operational_product_id);
  await page.getByText('Catálogo Técnico criado em rascunho.', { exact: true }).waitFor();
  assert.equal(await page.locator('.catalog-editor__operational select').inputValue(), catalog.operational_product_id);
  await page.screenshot({ path: `${output}/twin-mobile.png`, fullPage: true });
  await open(cp.commercial_product_id);
  assert.equal(await page.locator('.catalog-editor__operational select').inputValue(), catalog.operational_product_id);
  assert.equal(await page.getByLabel('Código comercial', { exact: true }).inputValue(), String(cp.commercial_number));
  const product = (await pool.query('SELECT * FROM products WHERE id=$1', [catalog.operational_product_id])).rows[0];
  assert.equal(product.name, cp.product_name); assert.equal(product.type, 'manufactured');
  assert.equal(product.sector_id, selectedSector); assert.equal(product.review_status, 'pending_review');
  for (const field of ['operational_cost', 'default_total_weight_kg', 'default_volume_quantity', 'measurement_unit_code']) assert.equal(product[field], null);
  const refs = (await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='product_id' AND table_name<>'product_catalogs'")).rows;
  report.zeroOperationalRows = {};
  for (const { table_name: table } of refs) {
    assert.match(table, /^[a-z_]+$/);
    report.zeroOperationalRows[table] = Number((await pool.query(`SELECT count(*) n FROM ${table} WHERE product_id=$1`, [product.id])).rows[0].n);
    assert.equal(report.zeroOperationalRows[table], 0, table);
  }
  report.automaticTwin = { pendingReview: true, manufactured: true, selected: true, persistedAfterReload: true, independentCodes: { commercial: cp.commercial_number, operational: product.internal_code } };
  await page.goto(`${host}/produtos`);
  await page.getByLabel('Revisão').selectOption('pending_review');
  await page.getByPlaceholder('Nome ou código interno').fill(cp.product_name);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByText(cp.product_name, { exact: true }).waitFor();
  report.visibleInPendingInventory = true;

  // The explicit + path remains available and its result is reused by Catalog.
  const explicit = await create(`Validação explícita ${Date.now()}`);
  await open(explicit.commercial_product_id);
  await page.getByRole('button', { name: 'Criar Produto do Estoque', exact: true }).click();
  await page.getByLabel('Setor do produto operacional').selectOption(selectedSector);
  const quickResponse = page.waitForResponse(r => r.url().endsWith('/api/commercial/catalog/operational-products') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar e selecionar', exact: true }).click();
  const quick = await quickResponse; assert.equal(quick.status(), 200);
  const existing = await quick.json(); productIds.push(existing.id);
  await page.getByText('Produto criado e selecionado. Pendente de revisão.', { exact: true }).waitFor();
  assert.equal(await sector.count(), 0);
  const beforeCount = (await pool.query('SELECT count(*)::int n FROM products')).rows[0].n;
  const existingResponse = page.waitForResponse(r => r.url().endsWith('/api/commercial/catalog') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar primeira versão', exact: true }).click();
  const reused = await existingResponse; assert.equal(reused.status(), 201);
  assert.equal((await reused.json()).operational_product_id, existing.id);
  assert.equal((await pool.query('SELECT count(*)::int n FROM products')).rows[0].n, beforeCount);
  report.quickButtonAndSelectedExisting = true;

  await page.goto(`${host}/comercial/catalogo`);
  const sort = page.getByLabel('Ordenar por');
  await sort.waitFor(); await page.locator('.commercial-catalog__card').first().waitFor();
  const numbers = async () => (await page.locator('.commercial-catalog__card-body > small').allTextContents()).map(t => BigInt(t.match(/Código comercial (\d+)/)[1]));
  for (const direction of ['code_asc', 'code_desc']) {
    if (await sort.inputValue() !== direction) {
      const response = page.waitForResponse(r => r.url().includes(`/api/commercial/catalog?`) && r.url().includes(`sort=${direction}`));
      await sort.selectOption(direction); await response;
      await page.locator('.commercial-catalog__card').first().waitFor();
    }
    const values = await numbers();
    const order = direction === 'code_asc' ? 'ASC' : 'DESC';
    const expected = (await pool.query(`SELECT commercial_number FROM commercial_products WHERE is_active ORDER BY commercial_number ${order} LIMIT 20`)).rows.map(p => BigInt(p.commercial_number));
    assert.deepEqual(values, expected);
  }
  const nextResponse = page.waitForResponse(r => r.url().includes('/api/commercial/catalog?') && r.url().includes('page=2'));
  await page.getByRole('button', { name: 'Próxima', exact: true }).click(); await nextResponse;
  await page.locator('.commercial-catalog__card').first().waitFor();
  assert.deepEqual(await numbers(), (await pool.query('SELECT commercial_number FROM commercial_products WHERE is_active ORDER BY commercial_number DESC LIMIT 20 OFFSET 20')).rows.map(p => BigInt(p.commercial_number)));
  await page.getByPlaceholder('Nome ou código comercial').fill(String(cp.commercial_number));
  const searchResponse = page.waitForResponse(r => r.url().includes('/api/commercial/catalog?') && r.url().includes(`search=${cp.commercial_number}`));
  await page.getByRole('button', { name: 'Buscar', exact: true }).click(); await searchResponse;
  await page.getByRole('heading', { name: cp.product_name, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${output}/catalog-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${output}/catalog-desktop.png`, fullPage: true });
  report.globalSort = { asc: true, desc: true, pagination: true, codeSearch: true, noMobileOverflow: true };
  await fs.writeFile(`${output}/public-ui.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); console.log(await page.locator('body').innerText().catch(() => '')); }
  throw error;
} finally {
  if (browser) await browser.close();
  for (const id of commercialIds) {
    const linked = (await pool.query('SELECT operational_product_id FROM commercial_products WHERE id=$1', [id])).rows[0]?.operational_product_id;
    if (linked && !productIds.includes(linked)) productIds.push(linked);
    const catalogs = (await pool.query('SELECT id FROM product_catalogs WHERE commercial_product_id=$1', [id])).rows.map(c => c.id);
    const versions = (await pool.query('SELECT id FROM product_catalog_versions WHERE product_catalog_id=ANY($1::uuid[])', [catalogs])).rows.map(v => v.id);
    await pool.query('DELETE FROM audit_logs WHERE entity_id=ANY($1::uuid[])', [[id, ...catalogs, ...versions, linked].filter(Boolean)]);
    await pool.query('UPDATE product_catalogs SET active_version_id=NULL WHERE id=ANY($1::uuid[])', [catalogs]);
    await pool.query('DELETE FROM product_catalog_versions WHERE id=ANY($1::uuid[])', [versions]);
    await pool.query('DELETE FROM product_catalogs WHERE id=ANY($1::uuid[])', [catalogs]);
    await pool.query('DELETE FROM commercial_products WHERE id=$1', [id]);
  }
  for (const id of productIds) await pool.query("DELETE FROM products WHERE id=$1 AND creation_origin='commercial'", [id]);
  await pool.end();
}
