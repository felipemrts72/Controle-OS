import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { query, pool } from '../backend/src/database/pool.js';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const admin = (await query("SELECT id, username FROM users WHERE name='QA Férias Alertas' ORDER BY created_at DESC LIMIT 1")).rows[0];
assert.ok(admin);
const suffix = admin.username.replace(/_admin$/, '');
const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET || 'dev-secret');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const width of [320, 375, 390, 430, 768, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ tokenValue }) => {
      localStorage.setItem('token', tokenValue);
      localStorage.setItem('user', JSON.stringify({ id: 'qa', name: 'QA', role: 'admin', permissions: ['vacations.view'] }));
    }, { tokenValue: token });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5174/ferias');
    await page.getByRole('textbox', { name: 'Pesquisar funcionário' }).fill(suffix);
    await page.getByRole('button', { name: 'Pesquisar' }).click();
    await page.getByText('25 encontrado(s)').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Vencem em 4 meses/ }).first().click();
    await page.getByText('23 encontrado(s)').waitFor();
    await page.getByRole('button', { name: 'Próxima' }).click();
    await page.getByText('Página 2 de 2').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.vacations__employee').length === 3);
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, cards: document.querySelectorAll('.vacations__employee').length }));
    assert.ok(dimensions.document <= dimensions.viewport, `${width}px com rolagem horizontal: ${JSON.stringify(dimensions)}`);
    assert.equal(dimensions.cards, 3);
    if (width === 320) {
      await page.getByRole('button', { name: 'Vencidas' }).click();
      await page.getByText('1 encontrado(s)').waitFor();
      await page.getByText(/dia\(s\) em atraso/).first().waitFor();
      await page.getByRole('button', { name: 'Período adquirido' }).last().click();
      await page.getByText('24 encontrado(s)').waitFor();
      await page.getByRole('textbox', { name: 'Pesquisar funcionário' }).fill('inexistente');
      await page.getByRole('button', { name: 'Pesquisar' }).click();
      await page.getByText('Nenhum funcionário encontrado para os filtros selecionados.').waitFor();
      await page.getByRole('textbox', { name: 'Pesquisar funcionário' }).fill(suffix);
      await page.getByRole('button', { name: 'Pesquisar' }).click();
      await page.getByText('24 encontrado(s)').waitFor();
      await page.getByRole('button', { name: /Vencem em 4 meses/ }).first().click();
      await page.getByText('23 encontrado(s)').waitFor();
      await page.getByRole('button', { name: 'Próxima' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.vacations__employee').length === 3);
    }
    const screenshot = path.join(os.tmpdir(), `ferias-alertas-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(`${width}px: sem rolagem horizontal, 3 cartões na página 2, captura ${screenshot}`);
    await context.close();
  }
} finally {
  await browser.close();
  await pool.end();
}
