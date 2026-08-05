import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import pg from 'pg';
import { listPurchaseRequests, listPurchases } from '../backend/src/services/purchaseService.js';
import { pool as applicationPool } from '../backend/src/database/pool.js';
import { getDefaultRoute } from '../src/utils/permissions.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
after(async () => {
  await pool.end();
  await applicationPool.end();
});

test('banco preserva 99 permissões e as atribuições dos perfis reais', async () => {
  const permissionCount = await pool.query('SELECT COUNT(*)::int AS count FROM permissions');
  assert.equal(permissionCount.rows[0].count, 99);

  const roles = await pool.query(`
    SELECT r.slug, COUNT(rp.permission_id)::int AS permission_count
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    GROUP BY r.id, r.slug
    ORDER BY r.slug
  `);
  assert.deepEqual(Object.fromEntries(roles.rows.map((row) => [row.slug, row.permission_count])), {
    admin: 99,
    entregas: 7,
    estoquista: 31,
    expedicao_teste: 2,
    manager: 87,
    shipping: 6,
    viewer: 1,
  });

  const fingerprints = await pool.query(`
    SELECT r.slug, MD5(STRING_AGG(p.code, ',' ORDER BY p.code)) AS fingerprint
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id, r.slug
    ORDER BY r.slug
  `);
  assert.deepEqual(Object.fromEntries(fingerprints.rows.map((row) => [row.slug, row.fingerprint])), {
    admin: 'aa08d06801f09e91192a026c14597466',
    entregas: 'ee65b28cbedcf0c15781c95ed2b3d735',
    estoquista: '4147de53fecb8cceed603f9bd4417d98',
    expedicao_teste: '4058a46f901fe65fb1d7d37c6e4b29aa',
    manager: '5c316695de8fac14dade87805e755812',
    shipping: '412a91a80a208e587d66522830d53886',
    viewer: '6a6d90306885c821332ab0f5883176e8',
  });
});

test('todos os perfis reais possuem uma rota inicial acessível', async () => {
  const result = await pool.query(`
    SELECT r.slug, ARRAY_REMOVE(ARRAY_AGG(p.code ORDER BY p.code), NULL) AS permissions
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id, r.slug
    ORDER BY r.slug
  `);
  result.rows.forEach((role) => {
    const route = getDefaultRoute({ role_slug: role.slug, permissions: role.permissions });
    assert.notEqual(route, '/acesso-negado', role.slug);
  });
});

test('usuários reais continuam ligados aos perfis esperados', async () => {
  const result = await pool.query(`
    SELECT u.username, r.slug
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.username = ANY($1::text[])
    ORDER BY u.username
  `, [['admin', 'felipe', 'matheus', 'tv', 'tv-exibicao', 'codex_shipping_test']]);
  assert.deepEqual(Object.fromEntries(result.rows.map((row) => [row.username, row.slug])), {
    admin: 'admin',
    codex_shipping_test: 'entregas',
    felipe: 'admin',
    matheus: 'manager',
    tv: 'viewer',
    'tv-exibicao': 'viewer',
  });
});

test('nomes corrigidos mantêm IDs e slugs', async () => {
  const sector = await pool.query("SELECT id, name FROM sectors WHERE slug = 'expedicao'");
  const role = await pool.query("SELECT id, name FROM roles WHERE slug = 'expedicao_teste'");
  assert.deepEqual(sector.rows[0], { id: '23fde37d-677c-4c27-b4f2-c5be40053332', name: 'Expedição' });
  assert.deepEqual(role.rows[0], { id: '205f9333-45de-425b-a680-73ea3f0f33ed', name: 'Expedição Teste' });
});

test('consultas de compras ocultam valores sem purchases.view_values', async () => {
  const user = { username: 'synthetic', permissions: ['purchases.view'] };
  const [requests, purchases] = await Promise.all([
    listPurchaseRequests({ limit: 5 }, user),
    listPurchases({ limit: 5 }, user),
  ]);
  requests.data.forEach((row) => assert.equal(row.estimated_total, null));
  purchases.data.forEach((row) => {
    assert.equal(Object.hasOwn(row, 'total'), false);
    assert.equal(Object.hasOwn(row, 'freight'), false);
  });
});
