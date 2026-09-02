import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../backend/src/app.js';
import { pool } from '../backend/src/database/pool.js';

let server;
let baseUrl;
let adminToken;
let restrictedToken;
let databaseClient;
let realPoolConnect;
let realPoolQuery;

function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '5m' });
}

async function request(path, token, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
}

before(async () => {
  const [admin, restricted] = await Promise.all([
    pool.query(`SELECT u.id, u.username FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username='felipe' AND r.slug='admin' AND u.is_active=TRUE AND u.approval_status='approved'`),
    pool.query(`SELECT u.id, u.username FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username NOT IN ('admin','felipe') AND u.is_active=TRUE AND u.approval_status='approved' AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND p.code='commercial.quotes.view') ORDER BY u.id LIMIT 1`),
  ]);
  assert.ok(admin.rows[0] && restricted.rows[0]);
  adminToken = tokenFor(admin.rows[0]);
  restrictedToken = tokenFor(restricted.rows[0]);
  realPoolConnect = pool.connect.bind(pool);
  realPoolQuery = pool.query.bind(pool);
  databaseClient = await realPoolConnect();
  await databaseClient.query('BEGIN');
  pool.query = (sql, params) => databaseClient.query(sql, params);
  pool.connect = async () => ({
    query: (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim().toUpperCase())
      ? Promise.resolve({ rows: [], rowCount: 0 })
      : databaseClient.query(sql, params),
    release() {},
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  pool.connect = realPoolConnect;
  pool.query = realPoolQuery;
  if (databaseClient) await databaseClient.query('ROLLBACK').finally(() => databaseClient.release());
  await pool.end();
});

test('GET /api/commercial/quotes retorna 200 para Administrador', async () => {
  const response = await request('/api/commercial/quotes?limit=1', adminToken);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.items));
});

test('usuário sem commercial.quotes.view recebe 403', async () => {
  const response = await request('/api/commercial/quotes?limit=1', restrictedToken);
  assert.equal(response.status, 403);
});

test('permissões de escrita são verificadas antes da validação do payload', async () => {
  const restrictedCreate = await request('/api/commercial/quotes', restrictedToken, { method: 'POST', body: '{}' });
  assert.equal(restrictedCreate.status, 403);
  const adminCreate = await request('/api/commercial/quotes', adminToken, { method: 'POST', body: '{}' });
  assert.equal(adminCreate.status, 400);
  const restrictedStatus = await request('/api/commercial/quotes/invalid-id/status', restrictedToken, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
  assert.equal(restrictedStatus.status, 403);
});

test('endpoint PDF é protegido, entrega prévia e reutiliza o documento oficial com hash', async () => {
  const commercialCounterBefore = Number((await databaseClient.query(
    "SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key = 'global'",
  )).rows[0].last_value);
  const expectedCommercialNumber = String(commercialCounterBefore + 1);
  const payload = {
    customer_id: null,
    customer_name: 'Cliente PDF HTTP',
    quote_date: '2026-08-22',
    items: [{ name: 'Item manual PDF', unit: 'UN', description: 'Item de teste controlado', quantity: 1, unit_price: 123.45, discount_amount: 0, save_product: true }],
    payment_methods: [{ method_type: 'pix', description: 'PIX integral', calculation_type: 'percentage', percentage: 100, installment_count: 1 }],
    notes: 'Observação comercial HTTP',
    internal_notes: 'SEGREDO INTERNO HTTP',
  };
  const createdResponse = await request('/api/commercial/quotes', adminToken, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.commercial_number, expectedCommercialNumber);
  assert.match(created.quote_number, /^ORC-2026-\d{6}$/);
  assert.equal('company_logo_snapshot' in created, false);

  const searchResponse = await request(`/api/commercial/quotes?search=${expectedCommercialNumber}`, adminToken);
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.equal(search.items.some((quote) => quote.id === created.id && quote.commercial_number === expectedCommercialNumber), true);

  const restrictedPdf = await request(`/api/commercial/quotes/${created.id}/pdf`, restrictedToken);
  assert.equal(restrictedPdf.status, 403);

  const preview = await request(`/api/commercial/quotes/${created.id}/pdf`, adminToken);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /application\/pdf/);
  assert.equal(preview.headers.get('x-quote-document'), 'draft-preview');
  assert.equal(
    preview.headers.get('content-disposition'),
    `inline; filename="Orcamento-${expectedCommercialNumber}-Rascunho.pdf"`,
  );
  assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  const sentResponse = await request(`/api/commercial/quotes/${created.id}/status`, adminToken, { method: 'PATCH', body: JSON.stringify({ status: 'sent' }) });
  assert.equal(sentResponse.status, 200);
  const first = await request(`/api/commercial/quotes/${created.id}/pdf`, adminToken);
  const firstBuffer = Buffer.from(await first.arrayBuffer());
  const hash = first.headers.get('x-document-sha256');
  assert.equal(first.headers.get('x-quote-document'), 'official');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(first.headers.get('x-document-version'), '1');

  const second = await request(`/api/commercial/quotes/${created.id}/pdf?download=1`, adminToken);
  const secondBuffer = Buffer.from(await second.arrayBuffer());
  assert.deepEqual(secondBuffer, firstBuffer);
  assert.equal(second.headers.get('x-document-sha256'), hash);
  assert.equal(
    second.headers.get('content-disposition'),
    `attachment; filename="Orcamento-${expectedCommercialNumber}.pdf"`,
  );
});

test('PDF legado é RECONSTRUCTED, protegido e idêntico em visualização e download', async () => {
  const legacy = (await databaseClient.query(`SELECT id,legacy_number FROM commercial_legacy_quotes
    WHERE EXISTS(SELECT 1 FROM commercial_legacy_quote_items i
      WHERE i.commercial_legacy_quote_id=commercial_legacy_quotes.id AND i.source_catalog_version_id IS NOT NULL)
    ORDER BY legacy_number LIMIT 1`)).rows[0];
  const restricted = await request(`/api/commercial/quotes/legacy/${legacy.id}/pdf`,restrictedToken);
  assert.equal(restricted.status,403);

  const inline = await request(`/api/commercial/quotes/legacy/${legacy.id}/pdf`,adminToken);
  assert.equal(inline.status,200);
  assert.equal(inline.headers.get('x-quote-document'),'RECONSTRUCTED');
  assert.match(inline.headers.get('content-disposition'),new RegExp(`^inline; filename="Orcamento-${legacy.legacy_number}-Historico-Reconstruido\\.pdf"$`));
  const inlinePdf=Buffer.from(await inline.arrayBuffer());
  assert.equal(inlinePdf.subarray(0,5).toString(),'%PDF-');

  const download = await request(`/api/commercial/quotes/legacy/${legacy.id}/pdf?download=1`,adminToken);
  const downloadedPdf=Buffer.from(await download.arrayBuffer());
  assert.equal(download.status,200);
  assert.equal(download.headers.get('x-quote-document'),'RECONSTRUCTED');
  assert.match(download.headers.get('content-disposition'),/^attachment;/);
  assert.equal(download.headers.get('x-document-sha256'),inline.headers.get('x-document-sha256'));
  assert.deepEqual(downloadedPdf,inlinePdf);
});
