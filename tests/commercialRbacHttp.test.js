import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../backend/src/app.js';
import { pool } from '../backend/src/database/pool.js';

let server;
let baseUrl;
let adminToken;
let restrictedToken;

function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '5m' });
}

async function request(path, token, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
}

before(async () => {
  const [admin, restricted] = await Promise.all([
    pool.query(`
      SELECT u.id, u.username
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.username = 'felipe'
        AND u.is_active = TRUE
        AND u.approval_status = 'approved'
        AND r.slug = 'admin'
        AND r.is_active = TRUE
    `),
    pool.query(`
      SELECT u.id, u.username
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.username <> 'admin'
        AND u.username <> 'felipe'
        AND u.is_active = TRUE
        AND u.approval_status = 'approved'
        AND r.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = r.id
            AND p.code = 'commercial.customers.view'
        )
      ORDER BY u.id
      LIMIT 1
    `),
  ]);
  assert.ok(admin.rows[0], 'felipe deve estar ligado ao perfil admin ativo');
  assert.ok(restricted.rows[0], 'é necessário um usuário real sem acesso Comercial para a regressão');
  adminToken = tokenFor(admin.rows[0]);
  restrictedToken = tokenFor(restricted.rows[0]);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await pool.end();
});

test('GET /api/commercial/customers retorna 200 para felipe Administrador', async () => {
  const response = await request('/api/commercial/customers?limit=1', adminToken);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.items));
  assert.equal(typeof body.pagination.total, 'number');
});

test('usuário real sem commercial.customers.view recebe 403', async () => {
  const response = await request('/api/commercial/customers?limit=1', restrictedToken);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'Acesso não autorizado.' });
});

test('felipe Administrador alcança create/edit e recebe validação de payload, não 403', async () => {
  const createResponse = await request('/api/commercial/customers', adminToken, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(createResponse.status, 400);

  const editResponse = await request('/api/commercial/customers/invalid-id', adminToken, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Teste' }),
  });
  assert.equal(editResponse.status, 400);
});

test('usuário sem Comercial recebe 403 também em create/edit', async () => {
  const createResponse = await request('/api/commercial/customers', restrictedToken, {
    method: 'POST',
    body: JSON.stringify({ name: 'Não deve criar' }),
  });
  assert.equal(createResponse.status, 403);

  const editResponse = await request('/api/commercial/customers/invalid-id', restrictedToken, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Não deve editar' }),
  });
  assert.equal(editResponse.status, 403);
});

test('GET /api/commercial/catalog retorna 200 para Admin e 403 sem permissão', async () => {
  const adminResponse = await request('/api/commercial/catalog?limit=1', adminToken);
  assert.equal(adminResponse.status, 200);
  const body = await adminResponse.json();
  assert.ok(Array.isArray(body.items));

  const restrictedResponse = await request('/api/commercial/catalog?limit=1', restrictedToken);
  assert.equal(restrictedResponse.status, 403);
});
