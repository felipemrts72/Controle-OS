import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import { saveProduct } from '../backend/src/controllers/basicControllers.js';

const realProductId = '6af5ee0a-79da-4124-a2e1-6b4943f6916f';
const fixtureId = randomUUID();
const fixtureImageId = randomUUID();
const createdAt = new Date('2020-01-02T03:04:05.000Z');
let realBaseline;
let user;
let employeeSector;
let alternateSector;
let shippingSector;

async function realProductState() {
  const [product, photos, production, purchases] = await Promise.all([
    pool.query('SELECT * FROM products WHERE id = $1', [realProductId]),
    pool.query('SELECT id, stored_name, created_at, updated_at FROM product_images WHERE product_id = $1 ORDER BY id', [realProductId]),
    pool.query('SELECT COUNT(*)::int AS count FROM sold_items WHERE product_id = $1', [realProductId]),
    pool.query('SELECT COUNT(*)::int AS count FROM purchase_items WHERE internal_product_id = $1', [realProductId]),
  ]);
  return { product: product.rows[0], photos: photos.rows, production: production.rows[0].count, purchases: purchases.rows[0].count };
}

async function setupFixture(client, overrides = {}) {
  const data = {
    name: 'Produto fixture edição',
    type: 'manufactured',
    sector_id: employeeSector.id,
    default_volume_quantity: 2,
    default_total_weight_kg: 3.5,
    is_active: true,
    measurement_unit_code: 'UN',
    review_status: 'approved',
    creation_origin: 'manual',
    preliminary_created_by: null,
    preliminary_created_at: null,
    reviewed_by: user.id,
    reviewed_at: createdAt,
    ...overrides,
  };
  await client.query(
    `INSERT INTO products (
      id, name, type, sector_id, default_volume_quantity, default_total_weight_kg, is_active,
      created_at, updated_at, measurement_unit_code, review_status, creation_origin,
      preliminary_created_by, preliminary_created_at, reviewed_by, reviewed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      fixtureId, data.name, data.type, data.sector_id, data.default_volume_quantity,
      data.default_total_weight_kg, data.is_active, createdAt, data.measurement_unit_code,
      data.review_status, data.creation_origin, data.preliminary_created_by,
      data.preliminary_created_at, data.reviewed_by, data.reviewed_at,
    ],
  );
  await client.query(
    `INSERT INTO product_images (id, product_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1, $2, 'fixture.png', $3, 'image/png', 12, $4)`,
    [fixtureImageId, fixtureId, `${fixtureId}.png`, user.id],
  );
  return data;
}

function payload(overrides = {}) {
  return {
    name: 'Produto fixture edição',
    type: 'manufactured',
    sector_id: employeeSector.id,
    default_volume_quantity: 2,
    default_total_weight_kg: 3.5,
    is_active: true,
    measurement_unit_code: 'UN',
    review_status: 'approved',
    components: [],
    manufacturing_steps: [],
    ...overrides,
  };
}

async function invokeSave(body) {
  let responseStatus;
  let responseBody;
  let receivedError;
  const response = {
    status(value) { responseStatus = value; return this; },
    json(value) { responseBody = value; return this; },
  };
  await saveProduct(
    { params: { id: fixtureId }, body, user },
    response,
    (error) => { receivedError = error; },
  );
  if (receivedError) throw receivedError;
  return { status: responseStatus, body: responseBody };
}

async function withForcedRollback(action, { fixtureOverrides, inspect } = {}) {
  const originalConnect = pool.connect.bind(pool);
  let inspection;
  let rolledBack = false;
  pool.connect = async () => {
    const actual = await originalConnect();
    return {
      async query(text, params) {
        const command = typeof text === 'string' ? text.trim().toUpperCase() : '';
        if (command === 'BEGIN') {
          const result = await actual.query(text, params);
          await setupFixture(actual, fixtureOverrides);
          return result;
        }
        if (command === 'COMMIT') {
          try {
            if (inspect) inspection = await inspect(actual);
          } finally {
            await actual.query('ROLLBACK');
            rolledBack = true;
          }
          return { rows: [], rowCount: 0 };
        }
        if (command === 'ROLLBACK') {
          rolledBack = true;
          return actual.query('ROLLBACK');
        }
        return actual.query(text, params);
      },
      release: () => actual.release(),
    };
  };
  try {
    const value = await action();
    return { value, inspection, rolledBack };
  } finally {
    pool.connect = originalConnect;
  }
}

async function savedProduct(client) {
  return (await client.query('SELECT * FROM products WHERE id = $1', [fixtureId])).rows[0];
}

before(async () => {
  const [userResult, sectors] = await Promise.all([
    pool.query(`SELECT u.id, u.role, r.slug AS role_slug FROM users u LEFT JOIN roles r ON r.id=u.role_id
      WHERE u.is_active=TRUE AND u.approval_status='approved'
      ORDER BY (r.slug='admin' OR u.role='admin') DESC,u.id LIMIT 1`),
    pool.query(`SELECT id, slug FROM sectors WHERE is_active=TRUE ORDER BY (slug='expedicao'), id`),
  ]);
  assert.ok(userResult.rows[0] && sectors.rows.length >= 2, 'fixtures requerem usuário e setores ativos');
  user = { ...userResult.rows[0], is_super_admin: true, permissions: [] };
  shippingSector = sectors.rows.find((sector) => sector.slug === 'expedicao');
  const regularSectors = sectors.rows.filter((sector) => sector.slug !== 'expedicao');
  employeeSector = regularSectors[0];
  alternateSector = regularSectors[1] || shippingSector;
  assert.ok(shippingSector && employeeSector && alternateSector);
  realBaseline = await realProductState();
});

after(async () => {
  if (realBaseline) assert.deepEqual(await realProductState(), realBaseline);
  await pool.end();
});

const simpleEdits = [
  ['edita somente unidade', { measurement_unit_code: 'KG' }, (row) => assert.equal(row.measurement_unit_code, 'KG')],
  ['edita somente setor UUID válido', { sector_id: null }, (row) => assert.equal(row.sector_id, alternateSector.id), true],
  ['edita somente tipo válido', { type: 'material_prima' }, (row) => assert.equal(row.type, 'material_prima')],
  ['edita somente nome', { name: 'Produto fixture renomeado' }, (row) => assert.equal(row.name, 'Produto fixture renomeado')],
  ['edita somente peso', { default_total_weight_kg: 8.75 }, (row) => assert.equal(Number(row.default_total_weight_kg), 8.75)],
  ['edita somente volumes', { default_volume_quantity: 9 }, (row) => assert.equal(row.default_volume_quantity, 9)],
];

for (const [name, changes, check, useAlternateSector] of simpleEdits) {
  test(name, async () => {
    const body = payload({ ...changes, ...(useAlternateSector ? { sector_id: alternateSector.id } : {}) });
    const run = await withForcedRollback(() => invokeSave(body), { inspect: savedProduct });
    assert.equal(run.value.status, 200);
    check(run.inspection);
    assert.equal(run.inspection.id, fixtureId);
    assert.equal(run.rolledBack, true);
  });
}

test('edita vários campos simultaneamente', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ name: 'Produto múltiplo', type: 'material_prima', sector_id: alternateSector.id, measurement_unit_code: 'KG', default_volume_quantity: 4, default_total_weight_kg: 7.25 })),
    { inspect: savedProduct },
  );
  assert.equal(run.inspection.name, 'Produto múltiplo');
  assert.equal(run.inspection.type, 'material_prima');
  assert.equal(run.inspection.sector_id, alternateSector.id);
  assert.equal(run.inspection.measurement_unit_code, 'KG');
  assert.equal(run.inspection.default_volume_quantity, 4);
  assert.equal(Number(run.inspection.default_total_weight_kg), 7.25);
});

test('produto legado sem unidade aceita unidade válida', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ measurement_unit_code: 'KG' })),
    { fixtureOverrides: { measurement_unit_code: null }, inspect: savedProduct },
  );
  assert.equal(run.inspection.measurement_unit_code, 'KG');
  assert.equal(run.inspection.id, fixtureId);
});

for (const type of ['manufactured', 'material_prima', 'resale']) {
  test(`setor null é rejeitado para Produto ${type}`, async () => {
    await assert.rejects(
      () => withForcedRollback(() => invokeSave(payload({ type, sector_id: null }))),
      (error) => error.status === 400 && /setor respons.vel/.test(error.message),
    );
  });
}

test('produto preliminar permanece preliminar quando não aprovado', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ name: 'Preliminar editado', review_status: 'pending_review' })),
    {
      fixtureOverrides: { review_status: 'pending_review', creation_origin: 'purchases', preliminary_created_by: user.id, preliminary_created_at: createdAt, reviewed_by: null, reviewed_at: null },
      inspect: savedProduct,
    },
  );
  assert.equal(run.inspection.review_status, 'pending_review');
  assert.equal(run.inspection.name, 'Preliminar editado');
});

test('produto já revisado não volta para preliminar', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ review_status: 'pending_review' })),
    { inspect: savedProduct },
  );
  assert.equal(run.inspection.review_status, 'approved');
});

test('edição preserva foto', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ name: 'Com foto preservada' })),
    { inspect: async (client) => (await client.query('SELECT id, stored_name FROM product_images WHERE product_id=$1', [fixtureId])).rows },
  );
  assert.deepEqual(run.inspection, [{ id: fixtureImageId, stored_name: `${fixtureId}.png` }]);
});

test('edição preserva origem', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ review_status: 'pending_review', name: 'Origem preservada' })),
    {
      fixtureOverrides: { review_status: 'pending_review', creation_origin: 'purchases', preliminary_created_by: user.id, preliminary_created_at: createdAt, reviewed_by: null, reviewed_at: null },
      inspect: savedProduct,
    },
  );
  assert.equal(run.inspection.creation_origin, 'purchases');
});

test('edição preserva created_at e autoria disponível', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ review_status: 'pending_review', name: 'Datas preservadas' })),
    {
      fixtureOverrides: { review_status: 'pending_review', creation_origin: 'purchases', preliminary_created_by: user.id, preliminary_created_at: createdAt, reviewed_by: null, reviewed_at: null },
      inspect: savedProduct,
    },
  );
  assert.equal(run.inspection.created_at.toISOString(), createdAt.toISOString());
  assert.equal(run.inspection.preliminary_created_by, user.id);
  assert.equal(run.inspection.preliminary_created_at.toISOString(), createdAt.toISOString());
});

test('edição atualiza a mesma linha sem criar Produto duplicado', async () => {
  const run = await withForcedRollback(
    () => invokeSave(payload({ name: 'Mesmo Produto' })),
    { inspect: async (client) => (await client.query('SELECT COUNT(*)::int AS count FROM products WHERE id=$1', [fixtureId])).rows[0] },
  );
  assert.equal(run.inspection.count, 1);
  assert.equal(run.value.body.id, fixtureId);
});

test('fixtures e updates não alteram Produto real nem seus históricos', async () => {
  assert.deepEqual(await realProductState(), realBaseline);
});
