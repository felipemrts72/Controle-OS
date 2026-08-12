import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { pool } from '../backend/src/database/pool.js';
import { getProduct, saveProduct, searchProducts } from '../backend/src/controllers/basicControllers.js';
import { createInternalOrder } from '../backend/src/services/orderService.js';

const ids = {
  parent: randomUUID(),
  material: randomUUID(),
  manufactured: randomUUID(),
  resale: randomUUID(),
  inactive: randomUUID(),
  cycleA: randomUUID(),
  cycleB: randomUUID(),
  historicalRelation: randomUUID(),
};

let user;
let sector;
let shippingSector;

async function insertProduct(client, id, name, type, productSector, isActive = true) {
  await client.query(
    `INSERT INTO products (
      id,name,type,sector_id,default_volume_quantity,default_total_weight_kg,is_active,
      measurement_unit_code,review_status,creation_origin
     ) VALUES ($1,$2,$3,$4,1,1,$5,'UN','approved','manual')`,
    [id, name, type, productSector, isActive],
  );
}

async function setupFixtures(client) {
  await insertProduct(client, ids.parent, 'Estrutura fixture principal', 'manufactured', sector.id);
  await insertProduct(client, ids.material, 'Componente fixture matéria-prima', 'material_prima', sector.id);
  await insertProduct(client, ids.manufactured, 'Componente fixture fabricado', 'manufactured', sector.id);
  await insertProduct(client, ids.resale, 'Componente fixture revenda', 'resale', shippingSector.id);
  await insertProduct(client, ids.inactive, 'Componente fixture inativo', 'manufactured', sector.id, false);
  await insertProduct(client, ids.cycleA, 'Componente fixture ciclo A', 'manufactured', sector.id);
  await insertProduct(client, ids.cycleB, 'Componente fixture ciclo B', 'manufactured', sector.id);
  await client.query(
    `INSERT INTO product_components (id,product_id,material_product_id,component_name,sector_id,quantity,is_required)
     VALUES ($1,$2,$3,'Componente fixture inativo',$4,1,TRUE)`,
    [ids.historicalRelation, ids.parent, ids.inactive, sector.id],
  );
  await client.query(
    `INSERT INTO product_components (product_id,material_product_id,component_name,sector_id,quantity,is_required)
     VALUES
       ($1,$2,'Ciclo B',$3,1,TRUE),
       ($2,$4,'Estrutura principal',$3,1,TRUE)`,
    [ids.cycleA, ids.cycleB, sector.id, ids.parent],
  );
}

function productPayload(components, overrides = {}) {
  return {
    name: 'Estrutura fixture principal',
    type: 'manufactured',
    sector_id: sector.id,
    default_volume_quantity: 1,
    default_total_weight_kg: 1,
    is_active: true,
    measurement_unit_code: 'UN',
    review_status: 'approved',
    components,
    manufacturing_steps: [],
    ...overrides,
  };
}

function component(id, name, componentSector = sector.id, extra = {}) {
  return {
    material_product_id: id,
    component_name: name,
    sector_id: componentSector,
    quantity: 1,
    is_required: true,
    ...extra,
  };
}

async function callController(controller, request) {
  let status;
  let body;
  let receivedError;
  const response = {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  };
  await controller(request, response, (error) => { receivedError = error; });
  if (receivedError) throw receivedError;
  return { status, body };
}

function save(components, overrides) {
  return callController(saveProduct, {
    params: { id: ids.parent },
    body: productPayload(components, overrides),
    user,
  });
}

async function withTransactionFixture(action, inspect) {
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
        if (command === 'COMMIT') {
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
  } finally {
    pool.connect = originalConnect;
  }
}

async function withReadableFixture(action) {
  const client = await pool.connect();
  const originalPoolQuery = pool.query.bind(pool);
  try {
    await client.query('BEGIN');
    await setupFixtures(client);
    pool.query = client.query.bind(client);
    return await action();
  } finally {
    pool.query = originalPoolQuery;
    await client.query('ROLLBACK');
    client.release();
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
  sector = sectors.rows.find((row) => row.slug !== 'expedicao');
  assert.ok(user.id && sector && shippingSector, 'fixtures requerem usuário, setor e Expedição');
});

after(async () => pool.end());

test('frontend pesquisa componentes no servidor sem restringir tipo', () => {
  const form = fs.readFileSync(new URL('../src/components/ProductForm/ProductForm.jsx', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/components/ProductComponentsEditor/ProductComponentsEditor.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(form, /type=material_prima/);
  assert.match(editor, />Buscar componente</);
  assert.doesNotMatch(editor, />Buscar matéria-prima</);
  assert.match(editor, /component_candidates:\s*true/);
  assert.match(editor, /q:\s*normalizedSearch/);
  assert.match(editor, /Fabricado/);
  assert.match(editor, /Revenda/);
  assert.match(editor, /Matéria-prima/);
  assert.match(editor, /product\.type_name[\s\S]+product\.sector_name/);
  assert.doesNotMatch(editor, /<span>\{product\.sector_name\s*\|\|[^<]+<\/span>/);
});

for (const [label, targetId, targetName, targetType, targetSector] of [
  ['material_prima pode ser componente', ids.material, 'Componente fixture matéria-prima', 'material_prima', () => sector.id],
  ['manufactured pode ser componente', ids.manufactured, 'Componente fixture fabricado', 'manufactured', () => sector.id],
  ['resale pode ser componente', ids.resale, 'Componente fixture revenda', 'resale', () => shippingSector.id],
]) {
  test(label, async () => {
    const run = await withTransactionFixture(
      () => save([component(targetId, targetName, targetSector())]),
      async (client) => ({
        relation: (await client.query('SELECT * FROM product_components WHERE product_id=$1 AND material_product_id=$2', [ids.parent, targetId])).rows[0],
        target: (await client.query('SELECT type FROM products WHERE id=$1', [targetId])).rows[0],
      }),
    );
    assert.equal(run.value.status, 200);
    assert.equal(run.inspection.relation.material_product_id, targetId);
    assert.equal(run.inspection.target.type, targetType);
  });
}

test('Produto manufactured continua manufactured após ser componente', async () => {
  const run = await withTransactionFixture(
    () => save([component(ids.manufactured, 'Componente fixture fabricado')]),
    async (client) => (await client.query('SELECT type FROM products WHERE id=$1', [ids.manufactured])).rows[0],
  );
  assert.equal(run.inspection.type, 'manufactured');
});

test('Produto manufactured usado como componente continua vendável', async () => {
  const saleNumber = `CMP-${Date.now()}`;
  const run = await withTransactionFixture(
    () => createInternalOrder({
      sale_number: saleNumber,
      customer_name: 'Cliente fixture componentes',
      customer_phone: '',
      promised_date: '2026-12-31',
      delivery_type: 'retirada',
      items: [{ product_id: ids.manufactured, quantity: 1 }],
    }, user.id),
    async (client) => (await client.query(
      `SELECT si.product_id,p.type FROM sold_items si JOIN products p ON p.id=si.product_id
       JOIN internal_orders io ON io.id=si.internal_order_id WHERE io.sale_number=$1`,
      [saleNumber],
    )).rows[0],
  );
  assert.equal(run.inspection.product_id, ids.manufactured);
  assert.equal(run.inspection.type, 'manufactured');
});

test('Produto não pode ser componente dele mesmo', async () => {
  await assert.rejects(
    () => withTransactionFixture(() => save([component(ids.parent, 'Autorreferência')]), null),
    (error) => error.status === 409 && error.code === 'PRODUCT_COMPONENT_SELF_REFERENCE',
  );
});

test('relação duplicada é rejeitada', async () => {
  const duplicated = component(ids.manufactured, 'Componente fixture fabricado');
  await assert.rejects(
    () => withTransactionFixture(() => save([duplicated, { ...duplicated }]), null),
    (error) => error.status === 409 && error.code === 'PRODUCT_COMPONENT_DUPLICATE',
  );
});

test('ciclo de dependências A → B → C → A é rejeitado', async () => {
  await assert.rejects(
    () => withTransactionFixture(() => save([component(ids.cycleA, 'Componente fixture ciclo A')]), null),
    (error) => error.status === 409 && error.code === 'PRODUCT_COMPONENT_CYCLE',
  );
});

test('autocomplete retorna tipos distintos e omite Produto inativo', async () => withReadableFixture(async () => {
  const result = await callController(searchProducts, {
    query: { q: 'Componente fixture', component_candidates: 'true' },
  });
  const found = new Map(result.body.map((product) => [product.id, product]));
  assert.equal(found.get(ids.material)?.type, 'material_prima');
  assert.equal(found.get(ids.manufactured)?.type, 'manufactured');
  assert.equal(found.get(ids.resale)?.type, 'resale');
  assert.equal(found.has(ids.inactive), false);
}));

test('relação histórica com Produto inativado continua legível', async () => withReadableFixture(async () => {
  const result = await callController(getProduct, { params: { id: ids.parent } });
  const historical = result.body.components.find((item) => item.id === ids.historicalRelation);
  assert.equal(historical.material_product_id, ids.inactive);
  assert.equal(historical.material_product_is_active, false);
  assert.equal(historical.material_product_type, 'manufactured');
}));

test('relação histórica inativa é preservada com o mesmo ID ao salvar', async () => {
  const historical = component(ids.inactive, 'Componente fixture inativo', sector.id, { id: ids.historicalRelation });
  const run = await withTransactionFixture(
    () => save([historical], { name: 'Estrutura renomeada' }),
    async (client) => (await client.query('SELECT id,material_product_id FROM product_components WHERE id=$1', [ids.historicalRelation])).rows[0],
  );
  assert.deepEqual(run.inspection, { id: ids.historicalRelation, material_product_id: ids.inactive });
});

test('omitir components em atualização não apaga relações existentes', async () => {
  const run = await withTransactionFixture(
    () => save(undefined, { components: undefined, name: 'Estrutura sem payload de relações' }),
    async (client) => (await client.query('SELECT COUNT(*)::int count FROM product_components WHERE product_id=$1', [ids.parent])).rows[0],
  );
  assert.equal(run.inspection.count, 1);
});
