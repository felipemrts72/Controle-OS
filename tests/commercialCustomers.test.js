import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCustomerPayload,
  isValidCnpj,
  isValidCpf,
  listCustomers,
  normalizeCustomerDocument,
  normalizeCustomerName,
} from '../backend/src/services/customerService.js';
import { requirePermission } from '../backend/src/middlewares/authMiddleware.js';
import { pool } from '../backend/src/database/pool.js';

function run(middleware, permissions) {
  let received;
  middleware({ user: { username: 'synthetic', permissions } }, {}, (error) => { received = error || null; });
  return received;
}

test('normalização comercial permanece compatível com normalized_name da Produção', () => {
  assert.equal(normalizeCustomerName('  Cliente   Exemplo  '), 'cliente exemplo');
  assert.equal(normalizeCustomerDocument('529.982.247-25'), '52998224725');
});

test('valida CPF e CNPJ antes de persistir identidade comercial', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11.111.111/1111-11'), false);
});

test('payload estrutura cliente e sincroniza somente dados comerciais conhecidos', () => {
  const payload = buildCustomerPayload({
    person_type: 'legal',
    name: '  OliMen   Máquinas  ',
    trade_name: 'OliMen',
    tax_id: '11.222.333/0001-81',
    email: 'COMERCIAL@EXEMPLO.COM',
    zip_code: '78550-000',
    city: 'Sinop',
    state: 'mt',
  });
  assert.equal(payload.name, 'OliMen Máquinas');
  assert.equal(payload.normalized_name, 'olimen máquinas');
  assert.equal(payload.tax_id, '11222333000181');
  assert.equal(payload.email, 'comercial@exemplo.com');
  assert.equal(payload.zip_code, '78550000');
  assert.equal(payload.state, 'MT');
  assert.equal(Object.hasOwn(payload, 'carrier_name'), false);
});

test('busca textual não vira filtro universal quando não há dígitos', async () => {
  const originalConnect = pool.connect.bind(pool);
  const calls = [];
  pool.connect = async () => ({
    async query(text, params = []) {
      calls.push({ text, params: [...params] });
      if (String(text).includes('COUNT(*)::int AS total')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
    release() {},
  });
  try {
    await listCustomers({ search: 'Maria', status: 'all', page: 1, limit: 20 });
  } finally {
    pool.connect = originalConnect;
  }
  const countCall = calls.find((call) => String(call.text).includes('COUNT(*)::int AS total'));
  assert.equal(countCall.params.length, 1);
  assert.deepEqual(countCall.params, ['%maria%']);
  assert.doesNotMatch(countCall.text, /tax_id/);
});

test('permissões de clientes separam leitura, criação e edição', () => {
  const viewer = ['commercial.customers.view'];
  assert.equal(run(requirePermission('commercial.customers.view'), viewer), null);
  assert.equal(run(requirePermission('commercial.customers.create'), viewer)?.status, 403);
  assert.equal(run(requirePermission('commercial.customers.edit'), viewer)?.status, 403);
});

test('tela de Perfis apresenta nome, identificador e descrição das permissões', () => {
  const source = fs.readFileSync(new URL('../src/pages/RolesPage/RolesPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /permission\.visualName/);
  assert.match(source, /permission\.code/);
  assert.match(source, /permission\.description/);
});

test('migration de clientes é aditiva e mantém identidade por normalized_name', () => {
  const migration = fs.readFileSync(new URL('../database/migrations/20260817_commercial_customers.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE customers/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_active/);
  assert.match(migration, /idx_customers_tax_id_unique/);
  assert.match(migration, /WHERE r\.slug = 'admin'/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(migration, /ALTER\s+COLUMN\s+normalized_name/i);
});

test('migration de alinhamento preserva IDs, códigos e grants dos demais perfis', () => {
  const migration = fs.readFileSync(new URL('../database/migrations/20260817_z_permission_catalog_alignment.sql', import.meta.url), 'utf8');
  assert.match(migration, /ON CONFLICT \(code\) DO UPDATE/);
  assert.match(migration, /WHERE r\.slug = 'admin'/);
  assert.doesNotMatch(migration, /DELETE FROM role_permissions/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(migration, /UPDATE\s+role_permissions/i);
});

test('API Comercial não substitui nem amplia a rota operacional de autocomplete', () => {
  const commercialRoutes = fs.readFileSync(new URL('../backend/src/routes/customerRoutes.js', import.meta.url), 'utf8');
  const orderRoutes = fs.readFileSync(new URL('../backend/src/routes/internalOrderRoutes.js', import.meta.url), 'utf8');
  const orderService = fs.readFileSync(new URL('../backend/src/services/orderService.js', import.meta.url), 'utf8');
  assert.match(commercialRoutes, /commercial\.customers\.view/);
  assert.match(orderRoutes, /get\('\/customers', requirePermission\('orders\.view'\)/);
  assert.match(orderService, /ON CONFLICT \(normalized_name\) DO UPDATE/);
  assert.match(orderService, /SELECT id, name, phone, location, carrier_name, destination_uf/);
  assert.match(orderService, /INSERT INTO sold_items/);
  assert.match(orderService, /INSERT INTO shipment_volumes/);
  assert.match(orderService, /copyProductRouteToSoldItemTasks/);
});
