import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = new Map();
const browserEvents = [];
const replacements = [];

globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = {
  location: {
    pathname: '/produtos',
    replace: (path) => replacements.push(path),
  },
  dispatchEvent: (event) => browserEvents.push(event.type),
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { handleApiError, setSession } = await import('../src/services/api.js');

function resetBrowserState(pathname = '/produtos') {
  storage.clear();
  browserEvents.length = 0;
  replacements.length = 0;
  window.location.pathname = pathname;
  setSession('token-preservado', { id: 'user-id', permissions: ['products.view'] });
}

test('HTTP 401 limpa a sessão e encaminha para login', async () => {
  resetBrowserState();
  await assert.rejects(handleApiError({ response: { status: 401 }, config: { url: '/products' } }));
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(localStorage.getItem('user'), null);
  assert.deepEqual(browserEvents, ['controle-os-auth-cleared']);
  assert.deepEqual(replacements, ['/entrar']);
});

test('HTTP 403 preserva token, usuário e navegação', async () => {
  resetBrowserState('/roles');
  await assert.rejects(handleApiError({ response: { status: 403 }, config: { url: '/roles' } }));
  assert.equal(localStorage.getItem('token'), 'token-preservado');
  assert.ok(localStorage.getItem('user'));
  assert.deepEqual(browserEvents, []);
  assert.deepEqual(replacements, []);
});

test('HTTP 403 não executa logout nem gera aviso global duplicado', async () => {
  resetBrowserState('/compras/solicitacoes');
  await assert.rejects(handleApiError({ response: { status: 403 }, config: { url: '/sectors' } }));
  assert.equal(browserEvents.length, 0);
  assert.equal(replacements.length, 0);
  const source = fs.readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /toast\.(error|warning)|useToast/);
});

test('401 do login não invalida uma sessão por efeito colateral', async () => {
  resetBrowserState('/entrar');
  await assert.rejects(handleApiError({ response: { status: 401 }, config: { url: '/auth/login' } }));
  assert.equal(localStorage.getItem('token'), 'token-preservado');
  assert.deepEqual(browserEvents, []);
});

test('rota de página sem permissão exibe acesso negado sem redirecionar a sessão', () => {
  const routes = fs.readFileSync(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
  assert.match(routes, /if \(canAccessPermission\(user, permission\)\) return children;\s+return <AccessDenied \/>;/);
  assert.doesNotMatch(routes, /return defaultRoute === '\/acesso-negado'/);
});
