import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/database/pool.js';
import { buildAuthUser } from '../backend/src/services/permissionService.js';

const { chromium } = await import('file:///C:/Users/Win%2010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const host = 'http://localhost:4173';
const name = `Auditoria Vale ${randomUUID().slice(0, 8)}`;
let browser, employeeId, listId, itemId, token;
const report = { publicList: false, publicEdit: false, publicCancel: false, db: false, audit: false, widths: [] };
const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
async function api(path, method = 'GET', body) {
  const response = await fetch(`${host}/api/advances${path}`, { method, headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path} HTTP ${response.status}: ${data.message || ''}`);
  return data;
}
try {
  const admin = (await pool.query("SELECT u.*, r.slug AS role_slug FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = 'admin' AND u.is_active AND u.approval_status = 'approved' LIMIT 1")).rows[0];
  assert.ok(admin);
  const user = await buildAuthUser(admin);
  token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '15m' });
  const cycle = (await pool.query("SELECT id FROM advance_cycles WHERE status = 'open' LIMIT 1")).rows[0];
  assert.ok(cycle, 'É necessário um ciclo aberto para o teste funcional público.');
  employeeId = randomUUID();
  await pool.query('INSERT INTO employees (id, full_name, current_salary) VALUES ($1, $2, 10000)', [employeeId, name]);
  const created = await api('/individual', 'POST', { employee_id: employeeId, amount: '100,00', receipt_at: '2026-10-16T12:00', source_bank: 'Sicoob' });
  listId = created.list.id; itemId = created.item.id;
  const list = await api(`/lists/${listId}`);
  assert.equal(Number(list.total_amount), 100);
  report.publicList = true;

  browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  for (const width of [320, 375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 740 }, isMobile: true, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    await context.addInitScript(({ jwtToken, currentUser }) => {
      localStorage.setItem('token', jwtToken);
      localStorage.setItem('user', JSON.stringify(currentUser));
    }, { jwtToken: token, currentUser: user });
    const page = await context.newPage();
    await page.goto(`${host}/vales`, { waitUntil: 'commit', timeout: 60000 });
    const card = page.locator('.advances-page__card').filter({ hasText: name });
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getByRole('button', { name: 'Editar' }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Excluir' }).isVisible(), true);
    await card.getByRole('link', { name: 'Abrir lista' }).click();
    const line = page.locator('.advances-page__line').filter({ hasText: name });
    await line.waitFor();
    assert.equal(await line.getByRole('button', { name: 'Editar' }).isVisible(), true);
    assert.equal(await line.getByRole('button', { name: 'Excluir' }).isVisible(), true);
    await line.getByRole('button', { name: 'Editar' }).click();
    const modal = page.getByRole('dialog', { name: 'Editar Vale' });
    await modal.waitFor();
    assert.equal(await modal.getByLabel('Valor').isVisible(), true);
    const geometry = await modal.evaluate((element) => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth }));
    assert.ok(geometry.width <= width && geometry.scrollWidth <= width + 1, `overflow em ${width}px`);
    report.widths.push(width);
    if (width === 390) {
      await modal.getByLabel('Valor').fill('150,00');
      await modal.getByLabel('Data e hora do comprovante').fill('2026-10-17T09:30');
      await modal.getByRole('button', { name: 'Salvar alterações' }).click();
      await page.getByText('Vale atualizado com sucesso.').waitFor({ timeout: 15000 });
      await line.getByText('R$ 150,00').waitFor();
      const updated = await api(`/lists/${listId}`);
      assert.equal(Number(updated.total_amount), 150);
      assert.equal(Number(updated.items[0].amount), 150);
      report.publicEdit = true;
    } else {
      await modal.getByRole('button', { name: 'Voltar' }).click();
    }
    if (width === 430) {
      await line.getByRole('button', { name: 'Excluir', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Excluir Vale' });
      await confirmation.waitFor();
      await confirmation.getByText(name).waitFor();
      await confirmation.getByText('R$ 150,00').waitFor();
      await confirmation.getByRole('button', { name: 'Excluir Vale' }).click();
      await page.getByText('Vale excluído com sucesso.').waitFor({ timeout: 15000 });
      await line.waitFor({ state: 'detached' });
      report.publicCancel = true;
    }
    await context.close();
  }
  const edited = await pool.query('SELECT amount FROM advance_list_items WHERE id=$1', [itemId]);
  assert.equal(Number(edited.rows[0].amount), 150);
  const saved = (await pool.query('SELECT amount FROM advance_list_items WHERE id=$1', [itemId])).rows[0];
  assert.equal(Number(saved.amount), 150);
  report.db = true;
  const home = await api('/');
  assert.equal(home.lists.some((row) => row.id === listId), false);
  const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_type='advance_list' AND entity_id=$1 AND action IN ('individual_advance_update','individual_advance_cancel')", [listId]);
  assert.deepEqual(new Set(audit.rows.map((row) => row.action)), new Set(['individual_advance_update', 'individual_advance_cancel']));
  report.audit = true;
  console.log(JSON.stringify(report));
} finally {
  if (browser) await browser.close();
  if (listId && itemId) {
    const active = await pool.query("SELECT ali.xmin::text AS row_version FROM advance_list_items ali WHERE id=$1 AND status='active'", [itemId]);
    if (active.rows[0]) await api(`/lists/${listId}/individual/${itemId}`, 'DELETE', { row_version: active.rows[0].row_version });
  }
  if (employeeId) await pool.query('UPDATE employees SET deleted_at=NOW() WHERE id=$1', [employeeId]);
  await pool.end();
}

