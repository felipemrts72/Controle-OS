import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NAVIGATION_ENTRIES,
  PERMISSION_PRESENTATION,
  getNavigationItemsInOrder,
  getVisibleNavigation,
  isNavigationItemActive,
} from '../src/config/modulePresentation.js';
import { canAccessPermission, getDefaultRoute } from '../src/utils/permissions.js';

const userWith = (...permissions) => ({ role_slug: 'synthetic', permissions });

test('apresentação central cobre as 99 permissões sem módulos futuros', () => {
  assert.equal(Object.keys(PERMISSION_PRESENTATION).length, 99);
  assert.deepEqual(NAVIGATION_ENTRIES.map((entry) => entry.label), [
    'Dashboard', 'Produção', 'Estoque', 'Compras', 'Expedição', 'Administrativo', 'Configurações',
  ]);
  assert.equal(NAVIGATION_ENTRIES.some((entry) => ['Comercial', 'Financeiro'].includes(entry.label)), false);
  assert.deepEqual(NAVIGATION_ENTRIES.find((entry) => entry.id === 'stock').items.map((item) => item.label), ['Produtos']);
  assert.equal(NAVIGATION_ENTRIES[0].type, 'link');
});

test('nomes visuais preservam os códigos técnicos', () => {
  assert.equal(PERMISSION_PRESENTATION['orders.create'].name, 'Criar ordem de produção');
  assert.equal(PERMISSION_PRESENTATION['tv.view'].module, 'Produção');
  assert.equal(PERMISSION_PRESENTATION['roles.manage'].name, 'Gerenciar perfis');
  assert.equal(PERMISSION_PRESENTATION['labels.view'].module, 'Expedição');
  assert.equal(PERMISSION_PRESENTATION['sectors.view'].subdivision, 'Setores');
});

test('sidebar oculta itens e módulos sem permissão', () => {
  const receiver = getVisibleNavigation(userWith('purchases.receive'), canAccessPermission);
  assert.deepEqual(receiver.map((entry) => entry.label), ['Compras']);
  assert.deepEqual(receiver[0].items.map((item) => item.label), ['Recebimentos']);

  const noPermissions = getVisibleNavigation(userWith(), canAccessPermission);
  assert.deepEqual(noPermissions, []);

  const buyer = getVisibleNavigation(userWith('purchases.view'), canAccessPermission);
  assert.deepEqual(buyer.map((entry) => entry.label), ['Compras']);
  assert.equal(buyer[0].items.some((item) => item.label === 'Recebimentos'), false);
  assert.equal(buyer[0].items.some((item) => item.label === 'Aprovações'), false);

  const stockkeeper = getVisibleNavigation(userWith('products.view'), canAccessPermission);
  assert.deepEqual(stockkeeper.map((entry) => entry.label), ['Estoque']);
  assert.deepEqual(stockkeeper[0].items.map((item) => item.label), ['Produtos']);

  const warehouseProfile = getVisibleNavigation(userWith(
    'products.view', 'products.create', 'products.edit', 'purchases.view',
    'purchases.create_request', 'purchase_quotes.create', 'suppliers.view',
  ), canAccessPermission);
  assert.equal(warehouseProfile.some((entry) => entry.label === 'Estoque'), true);
  assert.equal(warehouseProfile.some((entry) => entry.label === 'Compras'), true);
  assert.equal(warehouseProfile.some((entry) => entry.label === 'Configurações'), false);
  assert.equal(warehouseProfile.some((entry) => entry.items?.some((item) => item.label === 'Setores')), false);
});

test('rota padrão usa dashboard ou a primeira rota realmente acessível', () => {
  assert.equal(getDefaultRoute(userWith('dashboard.view', 'purchases.view')), '/dashboard');
  assert.equal(getDefaultRoute(userWith('purchases.approve')), '/compras/aprovacoes');
  assert.equal(getDefaultRoute(userWith('purchases.receive')), '/compras/recebimentos');
  assert.equal(getDefaultRoute(userWith('shipping.audit.view')), '/auditoria-expedicoes');
  assert.equal(getDefaultRoute(userWith('sectors.view')), '/setores');
  assert.equal(getDefaultRoute(userWith('tv.view')), '/tv');
  assert.equal(getDefaultRoute(userWith('labels.view')), '/fila-etiquetas');
  assert.equal(getDefaultRoute(userWith('advances.reports.view')), '/vales/relatorios');
  assert.equal(getDefaultRoute(userWith()), '/acesso-negado');
});

test('rotas dinâmicas ativam os subitens corretos', () => {
  const items = getNavigationItemsInOrder();
  const orders = items.find((item) => item.to === '/os');
  const newOrder = items.find((item) => item.to === '/os/nova');
  const tv = items.find((item) => item.to === '/tv');
  const employees = items.find((item) => item.to === '/funcionarios');
  assert.equal(isNavigationItemActive(orders, '/os/abc/editar'), true);
  assert.equal(isNavigationItemActive(orders, '/os/nova'), false);
  assert.equal(isNavigationItemActive(newOrder, '/os/nova'), true);
  assert.equal(isNavigationItemActive(tv, '/tv/montagem'), true);
  assert.equal(isNavigationItemActive(employees, '/funcionarios/abc'), true);
});

test('rotas legadas, fullscreen, localStorage e regras mobile permanecem declaradas', () => {
  const routes = fs.readFileSync(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
  const sidebar = fs.readFileSync(new URL('../src/components/Sidebar/Sidebar.jsx', import.meta.url), 'utf8');
  const sidebarCss = fs.readFileSync(new URL('../src/components/Sidebar/Sidebar.css', import.meta.url), 'utf8');
  [
    '/dashboard', '/os', '/os/nova', '/os/:id', '/os/:id/editar', '/painel-tv', '/tv/:setorSlug',
    '/compras/recebimentos', '/funcionarios/:id', '/vales/:id',
  ].forEach((path) => assert.match(routes, new RegExp(path.replace(/[/:]/g, (value) => `\\${value}`))));
  assert.ok(routes.indexOf('path="/tv"') < routes.indexOf('path="/dashboard"'));
  assert.match(sidebar, /olimen-gestao:sidebar-open-groups/);
  assert.match(sidebarCss, /@media \(max-width: 900px\)/);
});
