import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAnyPermission, requirePermission } from '../backend/src/middlewares/authMiddleware.js';
import { assertPurchaseRequestTransitionPermission } from '../backend/src/services/purchaseService.js';
import fs from 'node:fs';
import { canAccessPermission, isSuperAdmin as isFrontendSuperAdmin } from '../src/utils/permissions.js';

function run(middleware, permissions) {
  let received;
  middleware({ user: { username: 'synthetic', permissions } }, {}, (error) => { received = error || null; });
  return received;
}

test('aprovação pode ler solicitações sem conceder aprovação a visualizadores', () => {
  const readRequests = requireAnyPermission('purchases.view', 'purchases.approve');
  assert.equal(run(readRequests, ['purchases.approve']), null);
  assert.equal(run(readRequests, ['purchases.view']), null);
  assert.equal(run(requirePermission('purchases.approve'), ['purchases.view'])?.status, 403);
});

test('recebimento pode ler pedidos sem conceder recebimento a visualizadores', () => {
  const readOrders = requireAnyPermission('purchases.view', 'purchases.receive');
  assert.equal(run(readOrders, ['purchases.receive']), null);
  assert.equal(run(readOrders, ['purchases.view']), null);
  assert.equal(run(requirePermission('purchases.receive'), ['purchases.view'])?.status, 403);
});

test('visualização não concede criação, edição, exclusão, aprovação ou valores', () => {
  const viewer = ['purchases.view'];
  ['purchases.create_request', 'purchases.edit_own_request', 'purchases.cancel', 'purchases.approve', 'purchases.receive', 'purchases.view_values']
    .forEach((permission) => assert.equal(run(requirePermission(permission), viewer)?.status, 403));
});

test('catálogos compartilhados aceitam leitura operacional e mantêm gerenciamento protegido', () => {
  const sectors = fs.readFileSync(new URL('../backend/src/routes/sectorRoutes.js', import.meta.url), 'utf8');
  const products = fs.readFileSync(new URL('../backend/src/routes/productRoutes.js', import.meta.url), 'utf8');
  const purchases = fs.readFileSync(new URL('../backend/src/routes/purchaseRoutes.js', import.meta.url), 'utf8');

  ['products.view', 'products.create', 'products.edit', 'orders.view', 'purchases.view', 'purchases.create_request', 'services.view', 'tv.view']
    .forEach((permission) => assert.match(sectors, new RegExp(`'${permission.replace('.', '\\.')}'`)));
  assert.match(sectors, /post\('\/', requirePermission\('sectors\.manage'\)/);
  assert.match(sectors, /put\('\/:id', requirePermission\('sectors\.manage'\)/);
  assert.match(sectors, /patch\('\/:id\/deactivate', requirePermission\('sectors\.manage'\)/);

  assert.match(products, /get\('\/types', requireAnyPermission\('products\.view', 'products\.create', 'products\.edit', 'products\.types\.manage'\)/);
  assert.match(products, /post\('\/types', requirePermission\('products\.types\.manage'\)/);

  assert.match(purchases, /materialGroupRoutes\.get\('\/', requireAnyPermission\('purchases\.view','purchases\.create_request','purchase_quotes\.create','suppliers\.view','supplier_groups\.manage'\)/);
  assert.match(purchases, /materialGroupRoutes\.post\('\/', requirePermission\('supplier_groups\.manage'\)/);
  assert.match(purchases, /materialGroupRoutes\.put\('\/:id', requirePermission\('supplier_groups\.manage'\)/);
});

test('perfil de Estoquista lê auxiliares sem ganhar gerenciamento ou Configurações', () => {
  const stockkeeper = [
    'products.view', 'products.create', 'products.edit', 'products.delete', 'products.types.manage',
    'purchases.view', 'purchases.create_request', 'purchase_quotes.create', 'suppliers.view',
    'purchase_items.import', 'supplier_catalog.view', 'supplier_catalog.manage',
  ];
  const readSectors = requireAnyPermission(
    'sectors.view',
    'products.view', 'products.create', 'products.edit',
    'orders.view', 'orders.create', 'orders.edit',
    'purchases.view', 'purchases.create_request',
    'employees.view', 'employees.create', 'employees.edit', 'employees.manage',
    'services.view', 'tv.view',
  );
  const readGroups = requireAnyPermission(
    'purchases.view', 'purchases.create_request', 'purchase_quotes.create', 'suppliers.view', 'supplier_groups.manage',
  );

  assert.equal(run(requirePermission('products.view'), stockkeeper), null);
  assert.equal(run(requirePermission('purchases.view'), stockkeeper), null);
  assert.equal(run(readSectors, stockkeeper), null);
  assert.equal(run(readGroups, stockkeeper), null);
  assert.equal(run(requirePermission('sectors.manage'), stockkeeper)?.status, 403);
  assert.equal(run(requirePermission('supplier_groups.manage'), stockkeeper)?.status, 403);
  assert.equal(run(requirePermission('roles.view'), stockkeeper)?.status, 403);
  assert.equal(run(requirePermission('purchases.approve'), stockkeeper)?.status, 403);
});

test('administrador continua autorizado sem depender de permissão individual', () => {
  assert.equal(run(requirePermission('roles.manage'), [])?.status, 403);
  let received;
  requirePermission('roles.manage')({ user: { username: 'admin', permissions: [] } }, {}, (error) => { received = error || null; });
  assert.equal(received, null);
});

test('perfil com slug admin usa role_permissions e não um bypass concorrente', () => {
  assert.equal(run(requirePermission('commercial.customers.view'), [{ code: 'invalid' }])?.status, 403);
  let received;
  requirePermission('commercial.customers.view')({
    user: { username: 'felipe', role: 'admin', role_slug: 'admin', permissions: ['commercial.customers.view'] },
  }, {}, (error) => { received = error || null; });
  assert.equal(received, null);

  requirePermission('commercial.customers.edit')({
    user: { username: 'felipe', role: 'admin', role_slug: 'admin', permissions: ['commercial.customers.view'] },
  }, {}, (error) => { received = error || null; });
  assert.equal(received?.status, 403);

  const frontendUser = {
    username: 'felipe', role: 'admin', role_slug: 'admin', permissions: ['commercial.customers.view'],
  };
  assert.equal(isFrontendSuperAdmin(frontendUser), false);
  assert.equal(canAccessPermission(frontendUser, 'commercial.customers.view'), true);
  assert.equal(canAccessPermission(frontendUser, 'commercial.customers.edit'), false);
});

test('ação direta de aprovação sem purchases.approve retorna 403 em memória', () => {
  assert.throws(
    () => assertPurchaseRequestTransitionPermission(
      'approve',
      { requester_id: 'requester-id', status: 'pending_approval' },
      { id: 'stockkeeper-id', username: 'synthetic-stockkeeper', permissions: ['purchases.view', 'purchases.create_request'] },
    ),
    (error) => error.status === 403,
  );
});
