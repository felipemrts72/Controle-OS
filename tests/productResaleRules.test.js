import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { pool } from '../backend/src/database/pool.js';
import { saveProduct } from '../backend/src/controllers/basicControllers.js';

const ids = {
  resale: randomUUID(),
  manufactured: randomUUID(),
  legacyResale: randomUUID(),
  routeStep: randomUUID(),
  legacyRouteStep: randomUUID(),
};

let user;
let regularSector;
let alternateSector;
let shippingSector;

async function insertProduct(client, id, type, sectorId, name) {
  await client.query(
    `INSERT INTO products (
      id,name,type,sector_id,default_volume_quantity,default_total_weight_kg,is_active,
      measurement_unit_code,review_status,creation_origin
     ) VALUES ($1,$2,$3,$4,1,1,TRUE,'UN','approved','manual')`,
    [id, name, type, sectorId],
  );
}

async function setupFixtures(client) {
  await insertProduct(client, ids.resale, 'resale', regularSector.id, 'Revenda fixture setor livre');
  await insertProduct(client, ids.manufactured, 'manufactured', regularSector.id, 'Fabricado fixture com roteiro');
  await insertProduct(client, ids.legacyResale, 'resale', shippingSector.id, 'Revenda legada Expedição');
  await client.query(
    `INSERT INTO product_manufacturing_steps (id,product_id,name,sector_id,quantity,sort_order)
     VALUES ($1,$2,'Montagem fixture',$3,1,1)`,
    [ids.routeStep, ids.manufactured, regularSector.id],
  );
  await client.query(
    `INSERT INTO product_manufacturing_steps (id,product_id,name,sector_id,quantity,sort_order)
     VALUES ($1,$2,'Roteiro legado Revenda',$3,1,1)`,
    [ids.legacyRouteStep, ids.legacyResale, shippingSector.id],
  );
}

function payload(id, type, sectorId, overrides = {}) {
  const names = {
    [ids.resale]: 'Revenda fixture setor livre',
    [ids.manufactured]: 'Fabricado fixture com roteiro',
    [ids.legacyResale]: 'Revenda legada Expedição',
  };
  return {
    name: names[id] || 'Revenda nova fixture',
    type,
    sector_id: sectorId,
    default_volume_quantity: 1,
    default_total_weight_kg: 1,
    is_active: true,
    measurement_unit_code: 'UN',
    operational_cost: 0,
    review_status: 'approved',
    components: [],
    ...overrides,
  };
}

async function invokeSave(id, body) {
  let status;
  let responseBody;
  let receivedError;
  await saveProduct(
    { params: id ? { id } : {}, body, user },
    {
      status(value) { status = value; return this; },
      json(value) { responseBody = value; return this; },
    },
    (error) => { receivedError = error; },
  );
  if (receivedError) throw receivedError;
  return { status, body: responseBody };
}

async function withRollback(action, inspect) {
  const originalConnect = pool.connect.bind(pool);
  let inspection;
  pool.connect = async () => {
    const actual = await originalConnect();
    return {
      async query(text, params) {
        const command = typeof text === 'string' ? text.trim().toUpperCase() : '';
        if (command === 'BEGIN') {
          const result = await actual.query(text, params);
          await setupFixtures(actual);
          return result;
        }
        if (command === 'COMMIT' || command === 'ROLLBACK') {
          try {
            if (inspect) inspection = await inspect(actual);
          } finally {
            await actual.query('ROLLBACK');
          }
          return { rows: [], rowCount: 0 };
        }
        return actual.query(text, params);
      },
      release: () => actual.release(),
    };
  };
  try {
    const value = await action();
    return { value, inspection };
  } catch (error) {
    error.inspection = inspection;
    throw error;
  } finally {
    pool.connect = originalConnect;
  }
}

before(async () => {
  const [userResult, sectors] = await Promise.all([
    pool.query(`SELECT u.id,u.role,r.slug role_slug FROM users u LEFT JOIN roles r ON r.id=u.role_id
      WHERE u.is_active=TRUE AND u.approval_status='approved'
      ORDER BY (r.slug='admin' OR u.role='admin') DESC,u.id LIMIT 1`),
    pool.query('SELECT id,slug FROM sectors WHERE is_active=TRUE ORDER BY id'),
  ]);
  user = { ...userResult.rows[0], is_super_admin: true, permissions: [] };
  shippingSector = sectors.rows.find((row) => row.slug === 'expedicao');
  const regular = sectors.rows.filter((row) => row.slug !== 'expedicao');
  regularSector = regular[0];
  alternateSector = regular[1] || regular[0];
  assert.ok(user.id && shippingSector && regularSector && alternateSector);
});

after(async () => pool.end());

test('Revenda pode selecionar setor e não recebe Expedição automaticamente', async () => {
  const run = await withRollback(
    () => invokeSave(ids.resale, payload(ids.resale, 'resale', alternateSector.id)),
    async (client) => (await client.query('SELECT type,sector_id FROM products WHERE id=$1', [ids.resale])).rows[0],
  );
  assert.equal(run.value.status, 200);
  assert.deepEqual(run.inspection, { type: 'resale', sector_id: alternateSector.id });
  assert.notEqual(run.inspection.sector_id, shippingSector.id);
});

test('Revenda sem setor é rejeitada sem fallback silencioso', async () => {
  await assert.rejects(
    () => withRollback(
      () => invokeSave(ids.resale, payload(ids.resale, 'resale', null)),
      async (client) => (await client.query('SELECT sector_id FROM products WHERE id=$1', [ids.resale])).rows[0],
    ),
    (error) => error.status === 400 && /setor respons.vel/.test(error.message)
      && error.inspection.sector_id === regularSector.id,
  );
});

test('Revenda legada com Expedição permanece intacta ao editar', async () => {
  const run = await withRollback(
    () => invokeSave(ids.legacyResale, payload(ids.legacyResale, 'resale', shippingSector.id, { name: 'Revenda legada editada' })),
    async (client) => (await client.query('SELECT sector_id FROM products WHERE id=$1', [ids.legacyResale])).rows[0],
  );
  assert.equal(run.inspection.sector_id, shippingSector.id);
});

test('criar Revenda com setor escolhido não altera Revenda histórica', async () => {
  const run = await withRollback(
    () => invokeSave(null, payload(null, 'resale', regularSector.id)),
    async (client) => ({
      created: (await client.query("SELECT sector_id FROM products WHERE name='Revenda nova fixture' ORDER BY created_at DESC LIMIT 1")).rows[0],
      legacy: (await client.query('SELECT sector_id FROM products WHERE id=$1', [ids.legacyResale])).rows[0],
    }),
  );
  assert.equal(run.value.status, 201);
  assert.equal(run.inspection.created.sector_id, regularSector.id);
  assert.equal(run.inspection.legacy.sector_id, shippingSector.id);
});

test('frontend oculta roteiro para Revenda e mantém para outros tipos', () => {
  const form = fs.readFileSync(new URL('../src/components/ProductForm/ProductForm.jsx', import.meta.url), 'utf8');
  assert.match(form, /form\.type !== 'resale' && \(\s*<ProductManufacturingRouteEditor/);
  assert.doesNotMatch(form, /Revenda usa Expedição automaticamente/);
  assert.doesNotMatch(form, /disabled=\{form\.type === 'resale'\}/);
  assert.match(form, /select[\s\S]+name="sector_id"[\s\S]+required/);
});

test('mudar manufactured com roteiro para resale é bloqueado e preserva roteiro', async () => {
  await assert.rejects(
    () => withRollback(
      () => invokeSave(ids.manufactured, payload(ids.manufactured, 'resale', alternateSector.id, { manufacturing_steps: [] })),
      async (client) => ({
        product: (await client.query('SELECT type,sector_id FROM products WHERE id=$1', [ids.manufactured])).rows[0],
        steps: (await client.query('SELECT id FROM product_manufacturing_steps WHERE product_id=$1', [ids.manufactured])).rows,
      }),
    ),
    (error) => error.status === 409 && error.code === 'PRODUCT_RESALE_HAS_MANUFACTURING_ROUTE'
      && error.inspection.product.type === 'manufactured'
      && error.inspection.steps.length === 1
      && error.inspection.steps[0].id === ids.routeStep,
  );
});

test('Revenda legada com roteiro preserva o roteiro oculto em edição normal', async () => {
  const run = await withRollback(
    () => invokeSave(ids.legacyResale, payload(ids.legacyResale, 'resale', shippingSector.id, { manufacturing_steps: [] })),
    async (client) => (await client.query('SELECT name FROM product_manufacturing_steps WHERE product_id=$1', [ids.legacyResale])).rows,
  );
  assert.equal(run.value.status, 200);
  assert.deepEqual(run.inspection, [{ name: 'Roteiro legado Revenda' }]);
});
