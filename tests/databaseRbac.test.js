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

test('banco preserva atribuições comerciais explícitas de admin e gerente sem concedê-las ao estoque', async () => {
  const result = await pool.query(`SELECT r.slug,p.code FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id`);
  const byRole = Object.fromEntries([...new Set(result.rows.map((row) => row.slug))].map((slug) => [slug, new Set(result.rows.filter((row) => row.slug === slug).map((row) => row.code).filter(Boolean))]));
  const catalog = (await pool.query('SELECT code FROM permissions')).rows.map((row) => row.code);
  assert.deepEqual([...byRole.admin].sort(), catalog.sort(), 'Administrador deve ter todo o catálogo atual');
  for (const code of ['commercial.catalog.view','commercial.quotes.view','commercial.quotes.create']) assert.ok(byRole.manager.has(code), code);
  assert.ok(byRole.estoquista.has('products.cost.view'));
  assert.ok(byRole.estoquista.has('products.cost.edit'));
  assert.equal([...byRole.estoquista].some((code) => code.startsWith('commercial.')), false);
  assert.equal([...byRole.viewer].some((code) => code.startsWith('commercial.')), false);
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

test('usuários sintéticos continuam ligados aos perfis esperados', async () => {
  const result = await pool.query(`
    SELECT u.username, r.slug
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.username = ANY($1::text[])
    ORDER BY u.username
  `, [['admin', 'felipe', 'qa_manager', 'qa_viewer', 'qa_shipping']]);
  assert.deepEqual(Object.fromEntries(result.rows.map((row) => [row.username, row.slug])), {
    admin: 'admin',
    felipe: 'admin',
    qa_manager: 'manager',
    qa_shipping: 'entregas',
    qa_viewer: 'viewer',
  });
});

test('nomes corrigidos mantêm IDs e slugs', async () => {
  const sector = await pool.query("SELECT id, name FROM sectors WHERE slug = 'expedicao'");
  const role = await pool.query("SELECT id, name FROM roles WHERE slug = 'expedicao_teste'");
  assert.match(sector.rows[0].id, /^[0-9a-f-]{36}$/i);
  assert.equal(sector.rows[0].name, 'Expedição');
  assert.match(role.rows[0].id, /^[0-9a-f-]{36}$/i);
  assert.equal(role.rows[0].name, 'Expedição Teste');
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
