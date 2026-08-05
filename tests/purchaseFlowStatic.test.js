import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/PurchasesPage/PurchasesPage.jsx', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../backend/src/routes/purchaseRoutes.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../backend/src/services/purchaseService.js', import.meta.url), 'utf8');

test('ação rápida e página completa usam o mesmo endpoint de recebimento', () => {
  const endpointUses = page.match(/api\.post\(`\/purchases\/orders\/\$\{[^}]+\}\/receipts`/g) || [];
  assert.equal(endpointUses.length, 2);
  assert.equal((routes.match(/post\('\/orders\/:id\/receipts'/g) || []).length, 1);
  assert.equal((service.match(/export async function receivePurchase/g) || []).length, 1);
});

test('recebimento trata parcial, total, divergência, avaria e recusa sem movimentar estoque', () => {
  const start = service.indexOf('export async function receivePurchase');
  const end = service.indexOf('export async function cancelPurchase', start);
  const receiptImplementation = service.slice(start, end);
  assert.match(receiptImplementation, /partially_received/);
  assert.match(receiptImplementation, /received/);
  assert.match(receiptImplementation, /has_discrepancy/);
  assert.match(receiptImplementation, /is_damaged/);
  assert.match(receiptImplementation, /is_rejected/);
  assert.doesNotMatch(receiptImplementation, /stock|inventory|movement|moviment/i);
});

test('rotas de leitura usam permissões alternativas sem ampliar ações', () => {
  assert.match(routes, /get\('\/requests', requireAnyPermission\('purchases\.view','purchases\.approve'\)/);
  assert.match(routes, /get\('\/orders', requireAnyPermission\('purchases\.view','purchases\.receive'\)/);
  assert.match(routes, /post\('\/orders\/:id\/receipts', requirePermission\('purchases\.receive'\)/);
  assert.match(routes, /post\('\/requests\/:id\/transition', requireAnyPermission/);
});
