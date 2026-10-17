import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/database/pool.js';
import { app } from '../backend/src/app.js';
import { createCatalog, createCatalogVersion, getCatalogByCommercialProduct, publishCatalogVersion, updateCatalogVersion, deleteCatalogVersion, updateCatalogImage, deleteCatalogImage } from '../backend/src/services/productCatalogService.js';
import { createCommercialQuote, getCommercialQuote } from '../backend/src/services/commercialQuoteService.js';
import { buildQuotePreview, createOfficialQuoteDocument } from '../backend/src/services/commercialQuoteDocumentService.js';
import { getCatalogVersionUsage, lockQuoteCatalogVersions } from '../backend/src/services/catalogVersionUsageService.js';

after(() => pool.end());

const content = {
  commercial_title: 'Britador de Mandíbula 30×20',
  subtitle: 'Britador compacto para redução primária de pedras e minérios.',
  presentation_text: 'O Britador de Mandíbula 30×20 é indicado para a quebra e redução do material antes da etapa de moagem, preparando a granulometria para alimentação do moinho.',
  specifications: [{ name: 'Boca de britagem', value: '30 × 20 cm' }, { name: 'Motor', value: '13 CV' }],
  included_items: [{ description: 'Base completa com adaptações necessárias' }],
  applications_text: 'Britagem de pedras, minérios e materiais de mineração, especialmente como etapa de preparação antes do moinho.',
  additional_text: 'Estrutura reforçada\nEquipamento completo com motor', notes: null,
};

test('ciclo HTTP e persistência: publicar salva campos; sem uso edita V1; histórico bloqueia; nova V2 preserva V1', async () => {
  const connect = pool.connect.bind(pool); const query = pool.query.bind(pool);
  const client = await connect(); await client.query('BEGIN');
  pool.connect = async () => ({ query: (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) ? Promise.resolve({ rows: [] }) : client.query(sql, params), release() {} });
  pool.query = (sql, params) => client.query(sql, params);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const admin = (await client.query("SELECT u.* FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.is_active AND u.approval_status='approved' LIMIT 1")).rows[0];
    const user = { ...admin, permissions: ['commercial.catalog.sop.edit', 'commercial.catalog.sop.view', 'commercial.quotes.create'] };
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '5m' });
    const request = (url, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api/commercial/catalog${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const product = (await client.query('SELECT id FROM products WHERE is_active LIMIT 1')).rows[0];
    const cp = (await client.query("INSERT INTO commercial_products(name,operational_product_id) VALUES($1,$2) RETURNING *", [`Lifecycle ${Date.now()}`, product.id])).rows[0];
    const created = await createCatalog({ commercial_product_id: cp.id, version: { commercial_title: 'Inicial' } }, user);
    const id = created.versions[0].id;
    assert.equal(created.versions[0].version_number, 1);
    const published = await request(`/versions/${id}/publish`, 'POST', { version: content });
    assert.equal(published.status, 200);
    const saved = (await published.json()).versions[0];
    for (const field of ['commercial_title', 'subtitle', 'presentation_text', 'applications_text', 'additional_text', 'notes']) assert.equal(saved[field], content[field]);
    assert.deepEqual(saved.specifications.map(({ name, value }) => ({ name, value })), content.specifications);
    assert.deepEqual(saved.included_items.map(({ description }) => ({ description })), content.included_items);
    assert.equal(saved.images.length, 0);
    assert.equal(saved.is_used, false);
    const changed = { ...content, specifications: [...content.specifications].reverse(), included_items: [{ description: 'Segundo' }, ...content.included_items] };
    assert.equal((await request(`/versions/${id}`, 'PUT', changed)).status, 200);
    let reopened = await getCatalogByCommercialProduct(cp.id, user, client);
    assert.equal(reopened.versions.length, 1);
    assert.equal(reopened.versions[0].id, id);
    assert.equal(reopened.versions[0].version_number, 1);
    assert.equal(reopened.versions[0].specifications[0].name, 'Motor');
    assert.equal(reopened.versions[0].included_items[0].description, 'Segundo');
    const removed = { ...changed, specifications: [changed.specifications[1]], included_items: changed.included_items.slice(1) };
    await updateCatalogVersion(id, removed, user);
    reopened = await getCatalogByCommercialProduct(cp.id, user, client);
    assert.equal(reopened.versions[0].specifications.length, 1);
    assert.equal(reopened.versions[0].included_items.length, 1);
    await updateCatalogVersion(id, content, user);
    assert.equal((await request(`/${created.id}/versions`, 'POST', {})).status, 409);
    const quote = await createCommercialQuote({ quote_date: '2026-09-17', items: [{ commercial_product_id: cp.id, quantity: 1, unit_price: 100 }] }, user);
    await buildQuotePreview(quote, client);
    const standalone = await request(`/versions/${id}/pdf`);
    assert.equal(standalone.status, 200);
    assert.equal(standalone.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await standalone.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    await request(`/products/${cp.id}`);
    assert.equal((await getCatalogVersionUsage(client, [id])).get(id).is_used, false);
    assert.equal((await request(`/versions/${id}`, 'DELETE')).status, 409, 'draft FK is a structural restriction, not historical use');
    const before = (await getCatalogByCommercialProduct(cp.id, user, client)).versions[0];
    const official = await createOfficialQuoteDocument(client, { ...quote, status: 'sent' }, user.id);
    assert.equal(official.document_data_snapshot.catalogs[0].version_id, id);
    assert.equal((await request(`/versions/${id}`, 'PUT', { ...content, commercial_title: 'Forbidden' })).status, 409);
    assert.equal((await request(`/versions/${id}`, 'DELETE')).status, 409);
    await assert.rejects(updateCatalogVersion(id, content, user), { status: 409 });
    await assert.rejects(deleteCatalogVersion(id, user), { status: 409 });
    const image = (await client.query("INSERT INTO product_catalog_images(product_catalog_version_id,original_name,stored_name,mime_type,size_bytes) VALUES($1,'fixture.png','fixture.png','image/png',1) RETURNING id", [id])).rows[0];
    await assert.rejects(updateCatalogImage(image.id, { caption: 'Forbidden' }, user), { status: 409 });
    await assert.rejects(deleteCatalogImage(image.id, user), { status: 409 });
    await client.query('DELETE FROM product_catalog_images WHERE id=$1', [image.id]);
    const v2 = (await createCatalogVersion(created.id, user, id)).versions[0];
    assert.equal(v2.version_number, 2);
    await updateCatalogVersion(v2.id, { ...content, subtitle: 'Nova ficha' }, user);
    await publishCatalogVersion(v2.id, user);
    const old = (await getCatalogByCommercialProduct(cp.id, user, client)).versions.find((v) => v.id === id);
    const { is_used: _beforeUsage, ...beforeContent } = before;
    const { is_used: _afterUsage, ...oldContent } = old;
    assert.deepEqual(oldContent, beforeContent);
    assert.equal((await getCommercialQuote(quote.id, client)).items[0].product_catalog_version_id, id);
    const historic = await buildQuotePreview(await getCommercialQuote(quote.id, client), client);
    assert.equal(historic.data.catalogs[0].subtitle, content.subtitle);
    assert.equal((await client.query('SELECT sha256 FROM commercial_quote_documents WHERE id=$1', [official.id])).rows[0].sha256, official.sha256);
    assert.equal((await request(`/versions/${v2.id}`, 'DELETE')).status, 200);
    assert.equal((await getCatalogByCommercialProduct(cp.id, user, client)).versions.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.connect = connect; pool.query = query;
    await client.query('ROLLBACK'); client.release();
  }
});

test('concorrência real: emissão bloqueia edição até commit e nova consulta retorna 409', async () => {
  const cp = (await pool.query('INSERT INTO commercial_products(name) VALUES($1) RETURNING id', [`Concurrency catalog ${Date.now()}`])).rows[0];
  let catalog; let version; let quote; const emitting = await pool.connect();
  try {
    const user = (await pool.query('SELECT id FROM users WHERE is_active LIMIT 1')).rows[0];
    catalog = (await pool.query('INSERT INTO product_catalogs(commercial_product_id) VALUES($1) RETURNING id', [cp.id])).rows[0];
    version = (await pool.query("INSERT INTO product_catalog_versions(product_catalog_id,version_number,commercial_title,status,published_at) VALUES($1,1,'Concurrency','published',NOW()) RETURNING id", [catalog.id])).rows[0];
    // Minimal temporary document parent; no commercial number or sequence consumed.
    quote = (await pool.query(`INSERT INTO commercial_quotes(quote_number,customer_name_snapshot,customer_snapshot,company_snapshot,responsible_user_id,quote_date,created_by,updated_by)
      VALUES($1,'Fixture','{}','{}',$2,CURRENT_DATE,$2,$2) RETURNING id`, [`TEST-CATALOG-${Date.now()}`, user.id])).rows[0];
    await emitting.query('BEGIN');
    await lockQuoteCatalogVersions(emitting, { items: [{ product_catalog_version_id: version.id }] });
    await emitting.query(`INSERT INTO commercial_quote_documents(commercial_quote_id,document_version,quote_status,filename,pdf_data,byte_size,sha256,document_data_snapshot,company_snapshot)
      VALUES($1,1,'sent','test.pdf',$2,1,$3,$4,'{}')`, [quote.id, Buffer.from('x'), '0'.repeat(64), { catalogs: [{ version_id: version.id }] }]);
    let settled = false;
    const edit = updateCatalogVersion(version.id, content, user).then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    // Observe the actual PostgreSQL lock wait rather than relying on elapsed time.
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      blocked = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM product_catalog_versions WHERE id=%') blocked")).rows[0].blocked;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true); assert.equal(settled, false);
    await emitting.query('COMMIT');
    assert.equal((await edit)?.status, 409);
    assert.equal((await pool.query('SELECT commercial_title FROM product_catalog_versions WHERE id=$1', [version.id])).rows[0].commercial_title, 'Concurrency');
  } finally {
    await emitting.query('ROLLBACK'); emitting.release();
    if (quote) { await pool.query('DELETE FROM commercial_quote_documents WHERE commercial_quote_id=$1', [quote.id]); await pool.query('DELETE FROM commercial_quotes WHERE id=$1', [quote.id]); }
    if (version) await pool.query('DELETE FROM product_catalog_versions WHERE id=$1', [version.id]);
    if (catalog) await pool.query('DELETE FROM product_catalogs WHERE id=$1', [catalog.id]);
    await pool.query('DELETE FROM commercial_products WHERE id=$1', [cp.id]);
  }
});
