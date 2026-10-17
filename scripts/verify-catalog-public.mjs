// Reversible production smoke. Restores original business content in finally.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/database/pool.js';
import { buildAuthUser } from '../backend/src/services/permissionService.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/Win%2010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const host = 'https://os.torneadorauniversal.com.br';
const cp = '0592a871-cb8d-4e45-88c2-f3625dac2a5f';
const fields = ['commercial_title', 'subtitle', 'presentation_text', 'applications_text', 'additional_text', 'notes'];
let browser, original, headers, versionId;
const report = { at: new Date().toISOString(), http: [], browser: {}, builds: [] };
const data = (v) => ({ ...Object.fromEntries(fields.map((f) => [f, v[f]])), specifications: v.specifications.map(({ name, value, unit }) => ({ name, value, unit })), included_items: v.included_items.map(({ description, quantity, unit, notes }) => ({ description, quantity, unit, notes })) });
async function request(origin, route, method = 'GET', body) {
  const start = Date.now();
  const r = await fetch(`${origin}/api/commercial/catalog/${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  if (method === 'PUT') report.http.push({ origin, route, status: r.status, ms: Date.now() - start, bytes: Buffer.byteLength(JSON.stringify(body)), requestId: r.headers.get('x-request-id') });
  assert.equal(r.status, 200, `${origin} ${route}: ${text.slice(0,200)}`);
  return JSON.parse(text);
}
async function verify(expected) {
  const c = await request(host, `products/${cp}`);
  const v = c.versions.find((v) => v.id === versionId);
  assert.deepEqual(data(v), data(expected));
  assert.equal(c.versions.length, original.versions.length);
  assert.equal(v.version_number, original.versions.find((v) => v.id === versionId).version_number);
  assert.deepEqual(v.images, original.versions.find((v) => v.id === versionId).images);
  const db = (await pool.query('SELECT * FROM product_catalog_versions WHERE id=$1', [versionId])).rows[0];
  for (const field of fields) assert.equal(db[field], expected[field]);
  const specs = (await pool.query('SELECT name,value,unit FROM product_catalog_specifications WHERE product_catalog_version_id=$1 ORDER BY position', [versionId])).rows;
  const items = (await pool.query('SELECT description,quantity,unit,notes FROM product_catalog_included_items WHERE product_catalog_version_id=$1 ORDER BY position', [versionId])).rows;
  assert.deepEqual(specs, data(expected).specifications);
  assert.deepEqual(items, data(expected).included_items);
}
try {
  const row = (await pool.query("SELECT u.*,r.slug role_slug FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.is_active AND u.approval_status='approved' LIMIT 1")).rows[0];
  const user = await buildAuthUser(row);
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '15m' });
  headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  original = await request(host, `products/${cp}`);
  const v = original.versions.find((v) => v.id === original.active_version_id);
  assert.equal(v.is_used, false); assert.ok(v.images.length > 0); versionId = v.id;
  await fs.mkdir('tmp/catalog-public', { recursive: true });
  await fs.writeFile('tmp/catalog-public/persistence-original.json', JSON.stringify(original, null, 2));
  const imageUrl = `${host}${v.images[0].image_url}`;
  const imageHash = async () => crypto.createHash('sha256').update(Buffer.from(await (await fetch(imageUrl, { headers })).arrayBuffer())).digest('hex');
  const beforeImage = await imageHash();
  const base = { name: original.commercial_name, commercial_code: original.commercial_code, is_active: original.is_active, operational_product_id: original.operational_product_id, reference_price: original.reference_price, commercial_description: original.commercial_description, sop_discount_type: original.sop_discount_type, sop_discount_value: original.sop_discount_value };
  let expected;
  for (const origin of ['http://localhost:3333', 'http://localhost:4173', host]) {
    expected = { ...data(v), commercial_title: 'Jackpot 75 (H-3.5) — teste reversível', subtitle: `Subtítulo ${origin}`, presentation_text: 'Apresentação de teste', applications_text: 'Aplicações de teste', additional_text: 'Observações de teste', specifications: [{ name: 'Largura', value: '75', unit: null }], included_items: [{ description: 'Jackpot 75 cm', quantity: null, unit: null, notes: null }] };
    await request(origin, `products/${cp}`, 'PUT', base);
    await request(origin, `versions/${versionId}`, 'PUT', expected);
    await verify(expected);
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.addInitScript(({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }, { token, user });
  let page = await context.newPage();
  const traffic = [];
  context.on('request', (r) => { if (['PUT', 'POST'].includes(r.method()) && r.url().includes('/api/commercial/catalog')) traffic.push({ method: r.method(), url: r.url(), payload: JSON.parse(r.postData()), bytes: Buffer.byteLength(r.postData()) }); });
  const url = `${host}/comercial/catalogo/${cp}`;
  await page.goto(url);
  const labels = ['01 — Título comercial', '02 — Subtítulo', '03 — Apresentação', '06 — Aplicações', '07 — Observações'];
  const keys = ['commercial_title', 'subtitle', 'presentation_text', 'applications_text', 'additional_text'];
  for (let i = 0; i < labels.length; i++) { expected[keys[i]] = `Teste público ${i + 1}`; await page.getByLabel(labels[i]).fill(expected[keys[i]]); }
  await page.getByLabel('Característica', { exact: true }).fill('Largura teste'); expected.specifications[0].name = 'Largura teste';
  await page.getByLabel('Valor', { exact: true }).fill('76'); expected.specifications[0].value = '76';
  await page.getByLabel('Descrição do item').fill('Item teste público'); expected.included_items[0].description = 'Item teste público';
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByText('Alterações salvas.', { exact: true }).waitFor();
  async function checkForm() {
    for (let i = 0; i < labels.length; i++) { await page.getByLabel(labels[i]).waitFor(); assert.equal(await page.getByLabel(labels[i]).inputValue(), expected[keys[i]]); }
    assert.equal(await page.getByLabel('Característica', { exact: true }).inputValue(), 'Largura teste');
    assert.equal(await page.getByLabel('Valor', { exact: true }).inputValue(), '76');
    assert.equal(await page.getByLabel('Descrição do item').inputValue(), 'Item teste público');
    await page.locator('.catalog-editor__image-list img').first().waitFor();
    assert.equal(await page.locator('.catalog-editor__image-list img').count(), v.images.length);
    await page.getByRole('button', { name: 'Criar Produto do Estoque', exact: true }).click();
    assert.equal(await page.getByLabel('Nome do produto operacional').inputValue(), original.commercial_name);
    await page.getByLabel('Setor do produto operacional').locator('option').nth(1).waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
  await page.reload(); await checkForm();
  await page.close(); page = await context.newPage(); await page.goto(url); await checkForm();
  await verify(expected);
  const updates = traffic.filter((t) => t.method === 'PUT'); assert.equal(updates.length, 2);
  assert.ok(updates.every((t) => !('images' in t.payload)));
  assert.ok(!traffic.some((t) => t.url.includes('/images')));
  assert.equal(await imageHash(), beforeImage);
  await page.screenshot({ path: 'tmp/catalog-public/persistence-public.png', fullPage: true });
  report.browser = { groups: 7, reload: true, reopen: true, database: true, imageHash: beforeImage, noReupload: true, versionNumber: v.version_number, versionCount: original.versions.length, traffic, quickModal: true };
  for (const origin of ['http://localhost:4173', host]) {
    const html = await (await fetch(origin)).text(); const asset = html.match(/src="([^\"]+\.js)"/)[1];
    const body = Buffer.from(await (await fetch(origin + asset)).arrayBuffer());
    const local = await fs.readFile(`dist${asset}`); assert.deepEqual(body, local);
    report.builds.push({ origin, asset, sha256: crypto.createHash('sha256').update(body).digest('hex') });
  }
} finally {
  try {
    if (original && versionId) { const v = original.versions.find((v) => v.id === versionId); await request(host, `versions/${versionId}`, 'PUT', data(v)); await verify(v); report.restored = true; }
  } finally {
    if (browser) await browser.close(); await pool.end();
    await fs.writeFile('tmp/catalog-public/persistence-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
