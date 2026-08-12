import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listProducts } from '../backend/src/controllers/basicControllers.js';
import { pool } from '../backend/src/database/pool.js';
import { listImportProducts } from '../backend/src/services/purchaseImportService.js';

const productRoutes = fs.readFileSync(new URL('../backend/src/routes/productRoutes.js', import.meta.url), 'utf8');
const purchaseRoutes = fs.readFileSync(new URL('../backend/src/routes/purchaseRoutes.js', import.meta.url), 'utf8');
const productsPage = fs.readFileSync(new URL('../src/pages/ProductsPage/ProductsPage.jsx', import.meta.url), 'utf8');
const productsCss = fs.readFileSync(new URL('../src/pages/ProductsPage/ProductsPage.css', import.meta.url), 'utf8');

after(async () => pool.end());

function callListProducts(query = {}) {
  return new Promise((resolve, reject) => {
    listProducts({ query }, { json: resolve }, reject);
  });
}

async function sampleProduct(extraWhere = '') {
  const result = await pool.query(
    `SELECT p.*
     FROM products p
     WHERE COALESCE(p.is_active, TRUE) = TRUE ${extraWhere}
     ORDER BY length(p.name) DESC, p.created_at DESC
     LIMIT 1`,
  );
  assert.ok(result.rows[0], 'O teste requer ao menos um Produto ativo compatível.');
  return result.rows[0];
}

test('listagem explícita retorna somente a primeira página recente com limite padrão', async () => {
  const result = await callListProducts({ paginated: 'true' });
  assert.equal(result.page, 1);
  assert.equal(result.limit, 20);
  assert.ok(result.items.length <= 20);
  assert.equal(result.total_pages, Math.ceil(result.total / 20));
  for (let index = 1; index < result.items.length; index += 1) {
    const previous = result.items[index - 1];
    const current = result.items[index];
    assert.ok(new Date(previous.created_at).getTime() >= new Date(current.created_at).getTime());
  }
});

test('busca server-side aceita nome parcial e ignora diferença de maiúsculas', async () => {
  const sample = await sampleProduct('AND length(p.name) >= 5');
  const partial = sample.name.slice(1, 5).toLocaleUpperCase('pt-BR');
  const result = await callListProducts({ paginated: 'true', search: partial, limit: '100' });
  assert.ok(result.items.some((item) => item.id === sample.id));
  result.items.forEach((item) => {
    const searchable = `${item.name} ${item.internal_code || ''}`.toLocaleLowerCase('pt-BR');
    assert.ok(searchable.includes(partial.toLocaleLowerCase('pt-BR')));
  });
});

test('busca server-side localiza código interno sem alterar o endpoint de autocomplete', async () => {
  const template = await sampleProduct('AND p.sector_id IS NOT NULL');
  const internalCode = `BUSCA-${Date.now()}`;
  const created = await pool.query(
    `INSERT INTO products (
       name, type, sector_id, default_volume_quantity, default_total_weight_kg,
       is_active, internal_code, measurement_unit_code, review_status, creation_origin
     ) VALUES ($1, $2, $3, 1, 1, TRUE, $4, $5, 'approved', 'manual') RETURNING id`,
    [`Produto temporário ${internalCode}`, template.type, template.sector_id, internalCode, template.measurement_unit_code || 'UN'],
  );
  try {
    const result = await callListProducts({ paginated: 'true', search: internalCode.toLocaleLowerCase('pt-BR') });
    assert.ok(result.items.some((item) => item.id === created.rows[0].id));
    assert.match(productRoutes, /get\('\/search'/);
  } finally {
    await pool.query('DELETE FROM products WHERE id = $1', [created.rows[0].id]);
  }
});

test('filtros de tipo, setor e revisão são aplicados no banco e podem ser combinados', async () => {
  const sample = await sampleProduct("AND p.sector_id IS NOT NULL AND p.review_status IN ('pending_review', 'approved')");
  const search = sample.name.slice(0, Math.min(8, sample.name.length));
  const result = await callListProducts({
    paginated: 'true',
    search,
    product_type: sample.type,
    sector_id: sample.sector_id,
    review_status: sample.review_status,
    limit: '100',
  });
  assert.ok(result.items.some((item) => item.id === sample.id));
  result.items.forEach((item) => {
    assert.equal(item.type, sample.type);
    assert.equal(item.sector_id, sample.sector_id);
    assert.equal(item.review_status, sample.review_status);
  });
});

test('paginação não repete itens e limita qualquer solicitação a 100 registros', async () => {
  const first = await callListProducts({ paginated: 'true', page: '1', limit: '5' });
  const second = await callListProducts({ paginated: 'true', page: '2', limit: '5' });
  const maximum = await callListProducts({ paginated: 'true', limit: '999' });
  assert.equal(first.limit, 5);
  assert.equal(second.page, 2);
  assert.equal(maximum.limit, 100);
  const firstIds = new Set(first.items.map((item) => item.id));
  assert.equal(second.items.some((item) => firstIds.has(item.id)), false);
});

test('Produto preliminar aparece entre os recentes e no filtro de revisão', async () => {
  const template = await sampleProduct('AND p.sector_id IS NOT NULL');
  const user = (await pool.query('SELECT id FROM users ORDER BY created_at, id LIMIT 1')).rows[0];
  const uniqueName = `Produto preliminar paginação ${Date.now()}`;
  const created = await pool.query(
    `INSERT INTO products (
       name, type, sector_id, default_volume_quantity, default_total_weight_kg,
       is_active, measurement_unit_code, review_status, creation_origin,
       preliminary_created_by, preliminary_created_at
     ) VALUES ($1, $2, $3, 1, 1, TRUE, $4, 'pending_review', 'purchases', $5, NOW())
     RETURNING id`,
    [uniqueName, template.type, template.sector_id, template.measurement_unit_code || 'UN', user?.id || null],
  );
  try {
    const recent = await callListProducts({ paginated: 'true' });
    const pending = await callListProducts({ paginated: 'true', review_status: 'pending_review', search: uniqueName });
    assert.ok(recent.items.some((item) => item.id === created.rows[0].id));
    assert.ok(pending.items.some((item) => item.id === created.rows[0].id && item.creation_origin === 'purchases'));
  } finally {
    await pool.query('DELETE FROM products WHERE id = $1', [created.rows[0].id]);
  }
});

test('listagem informa Produtos com e sem foto sem baixar imagens antecipadamente', async () => {
  const withPhoto = await sampleProduct('AND EXISTS (SELECT 1 FROM product_images image WHERE image.product_id = p.id)');
  const withoutPhoto = await sampleProduct('AND NOT EXISTS (SELECT 1 FROM product_images image WHERE image.product_id = p.id)');
  const photoResult = await callListProducts({ paginated: 'true', search: withPhoto.name, limit: '100' });
  const noPhotoResult = await callListProducts({ paginated: 'true', search: withoutPhoto.name, limit: '100' });
  assert.equal(photoResult.items.find((item) => item.id === withPhoto.id)?.has_photo, true);
  assert.equal(noPhotoResult.items.find((item) => item.id === withoutPhoto.id)?.has_photo, false);
  assert.match(productsPage, /row\.has_photo[\s\S]+Ver foto/);
  assert.doesNotMatch(productsPage, /<img[^>]+src=/);
});

test('permissões de visualização, edição e exclusão continuam granulares', () => {
  assert.match(productRoutes, /get\('\/', requirePermission\('products\.view'\), listProducts\)/);
  assert.match(productsPage, /canAccessPermission\(user, 'products\.edit'\)/);
  assert.match(productsPage, /canAccessPermission\(user, 'products\.delete'\)/);
  assert.match(productsPage, /canEdit && <Link/);
  assert.match(productsPage, /canDelete &&/);
});

test('endpoint legado e catálogo de Compras permanecem compatíveis', async () => {
  const legacy = await callListProducts({});
  assert.ok(Array.isArray(legacy));
  const sample = await sampleProduct();
  const purchaseProducts = await listImportProducts(sample.name);
  assert.ok(purchaseProducts.some((item) => item.id === sample.id));
  assert.match(purchaseRoutes, /get\('\/products'/);
});

test('frontend usa paginação, debounce, cancelamento e estados visuais server-side', () => {
  assert.match(productsPage, /paginated: true/);
  assert.match(productsPage, /limit: PAGE_LIMIT/);
  assert.match(productsPage, /setTimeout[\s\S]+400/);
  assert.match(productsPage, /AbortController/);
  assert.match(productsPage, /Produtos recentes/);
  assert.match(productsPage, /Resultados da busca/);
  assert.match(productsPage, /Nenhum Produto encontrado para os filtros informados/);
  assert.match(productsPage, /Página \{pagination\.page\} de \{pagination\.total_pages\}/);
});

test('CSS mantém ações legíveis no desktop e converte a tabela em cards no mobile', () => {
  assert.match(productsCss, /min-width:\s*1500px/);
  assert.match(productsCss, /products-page__actions-column[\s\S]+white-space:\s*nowrap/);
  assert.match(productsCss, /products-page__row-actions[\s\S]+flex-wrap:\s*nowrap/);
  assert.match(productsCss, /@media \(max-width: 760px\)/);
  assert.match(productsCss, /min-height:\s*44px/);
  assert.match(productsCss, /grid-template-columns:\s*1fr/);
});
