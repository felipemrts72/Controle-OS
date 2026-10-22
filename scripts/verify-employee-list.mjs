import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import express from 'express';

const source = new URL(dotenv.parse(fs.readFileSync('.env')).DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname), 'A validação exige PostgreSQL local.');
const databaseName = `qa_funcionarios_${randomBytes(4).toString('hex')}`;
const adminUrl = new URL(source);
adminUrl.hostname = '127.0.0.1';
adminUrl.pathname = '/postgres';
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
let db, server, browser, appPool;
const checks = [];
const visuals = [];

async function request(base, path, token) {
  const response = await fetch(`${base}/api/employees${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
}
function json(result) { return JSON.parse(result.body.toString('utf8')); }
function params(filters) { return `?${new URLSearchParams(filters)}`; }

try {
  await admin.connect();
  assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name, 'postgres');
  await admin.query(`CREATE DATABASE ${databaseName}`);
  process.env.DATABASE_URL = testUrl.toString();
  process.env.JWT_SECRET = `qa-${randomBytes(20).toString('hex')}`;
  db = new pg.Pool({ connectionString: testUrl.toString() });
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL, name text NOT NULL, is_active boolean DEFAULT true);
    CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL);
    CREATE TABLE role_permissions (role_id uuid, permission_id uuid);
    CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, username text, role text, role_id uuid, is_active boolean DEFAULT true, approval_status text DEFAULT 'approved');
    CREATE TABLE sectors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true);
    CREATE TABLE employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, normalized_name text, cpf text, job_title text, sector_id uuid, admission_date date, employment_status text, registration_type text DEFAULT 'quick', profile_completed boolean DEFAULT true, current_salary numeric, meal_allowance numeric, created_at timestamp DEFAULT now(), deleted_at timestamp);`);
  const [roleView, rolePrint, roleBoth, roleNone] = await Promise.all(['view', 'print', 'both', 'none'].map(async (slug) =>
    (await db.query('INSERT INTO roles (slug,name) VALUES ($1,$1) RETURNING id', [slug])).rows[0].id));
  const permissionIds = {};
  for (const code of ['employees.view', 'employees.profile.print']) permissionIds[code] = (await db.query('INSERT INTO permissions (code) VALUES ($1) RETURNING id', [code])).rows[0].id;
  for (const [role, codes] of [[roleView, ['employees.view']], [rolePrint, ['employees.profile.print']], [roleBoth, ['employees.view', 'employees.profile.print']]]) {
    for (const code of codes) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [role, permissionIds[code]]);
  }
  const userIds = {};
  for (const [name, role] of Object.entries({ view: roleView, print: rolePrint, both: roleBoth, none: roleNone })) {
    userIds[name] = (await db.query("INSERT INTO users (name,username,role,role_id) VALUES ($1,$1,'viewer',$2) RETURNING id", [`qa_${name}`, role])).rows[0].id;
  }
  const sectorIds = {};
  for (const name of ['Produção', 'Administração']) sectorIds[name] = (await db.query('INSERT INTO sectors (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
  const fixtures = [];
  const add = (index, date, title, sector, status = 'ativo') => fixtures.push({
    full_name: `QA Funcionário ${String(index).padStart(2, '0')}`,
    admission_date: date, cpf: String(10000000000 + index), job_title: title,
    sector_name: sector, sector_id: sectorIds[sector], employment_status: status,
  });
  add(0, '2021-12-31', 'Costureira', 'Produção');
  add(1, '2022-01-01', 'Costureira', 'Produção');
  for (let i = 2; i <= 24; i++) add(i, i === 3 ? '2022-02-01' : `2022-${String(2 + Math.floor((i - 2) / 4)).padStart(2, '0')}-${String(1 + ((i - 2) % 4)).padStart(2, '0')}`, i % 2 ? 'Supervisora' : 'Costureira', i % 3 ? 'Produção' : 'Administração', i % 5 ? 'ativo' : 'desligado');
  add(25, '2022-08-31', 'Supervisora', 'Administração', 'desligado');
  add(26, '2022-09-01', 'Costureira', 'Produção');
  for (const row of fixtures.slice().reverse()) await db.query(
    'INSERT INTO employees (full_name,normalized_name,cpf,job_title,sector_id,admission_date,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [row.full_name, row.full_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), row.cpf, row.job_title, row.sector_id, row.admission_date, row.employment_status],
  );
  checks.push(`banco ${databaseName} isolado; ${fixtures.length} funcionários sintéticos`);

  const { app } = await import('../backend/src/app.js');
  const { pool } = await import('../backend/src/database/pool.js');
  appPool = pool;
  const { buildAuthUser } = await import('../backend/src/services/permissionService.js');
  const outer = express();
  outer.get('/__qa/login', async (_req, res, next) => {
    try {
      const user = await buildAuthUser((await db.query("SELECT u.*,r.slug AS role_slug,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1", [userIds.both])).rows[0]);
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.type('html').send(`<!doctype html><script>localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});location.replace('/funcionarios')</script>`);
    } catch (error) { next(error); }
  });
  outer.use(app);
  outer.use(express.static('dist'));
  outer.get('*', (_req, res) => res.sendFile('index.html', { root: `${process.cwd()}/dist` }));
  await new Promise((resolve) => { server = outer.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokens = Object.fromEntries(Object.entries(userIds).map(([name, id]) => [name, jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' })]));
  const period = { admission_from: '2022-01-01', admission_to: '2022-08-31' };
  const expected = fixtures.filter((row) => row.admission_date >= period.admission_from && row.admission_date <= period.admission_to)
    .sort((a, b) => a.admission_date.localeCompare(b.admission_date) || a.full_name.localeCompare(b.full_name));
  assert.equal(expected.length, 25);
  const first = json(await request(base, params({ ...period, page: 1 }), tokens.both));
  const second = json(await request(base, params({ ...period, page: 2 }), tokens.both));
  assert.equal(first.total, 25); assert.equal(first.rows.length, 20); assert.equal(second.rows.length, 5);
  assert.deepEqual([...first.rows, ...second.rows].map((row) => row.full_name), expected.map((row) => row.full_name));
  assert.equal(first.rows[0].admission_date, '2022-01-01');
  assert.equal(second.rows.at(-1).admission_date, '2022-08-31');
  checks.push('intervalo inclusivo, exclusão externa, paginação 20/5, total 25, datas e ordem');
  for (const [filters, matches] of [
    [{ ...period, search: 'Funcionário 01' }, (row) => row.full_name.includes('01')],
    [{ ...period, cpf: fixtures[12].cpf }, (row) => row.cpf === fixtures[12].cpf],
    [{ ...period, job_title: 'Costureira' }, (row) => row.job_title === 'Costureira'],
    [{ ...period, sector_id: sectorIds.Produção }, (row) => row.sector_name === 'Produção'],
    [{ ...period, status: 'desligado' }, (row) => row.employment_status === 'desligado'],
    [{ ...period, search: 'Funcionário 15', cpf: fixtures[15].cpf, job_title: fixtures[15].job_title, sector_id: fixtures[15].sector_id, status: fixtures[15].employment_status }, (row) => row.full_name === fixtures[15].full_name],
  ]) {
    const found = json(await request(base, params({ ...filters, page: 1 }), tokens.both));
    assert.deepEqual(found.rows.map((row) => row.full_name), expected.filter(matches).map((row) => row.full_name));
    assert.equal(found.total, expected.filter(matches).length);
  }
  assert.equal(json(await request(base, params({ admission_from: '2022-08-31', page: 1 }), tokens.both)).total, 2);
  assert.equal(json(await request(base, params({ admission_to: '2022-01-01', page: 1 }), tokens.both)).total, 2);
  checks.push('nome, CPF, cargo, setor, situação, combinação e limites isolados');
  assert.equal(json(await request(base, params({ ...period, search: 'Inexistente', page: 1 }), tokens.both)).total, 0);
  assert.equal((await request(base, params({ admission_from: '2022-09-01', admission_to: '2022-01-01', page: 1 }), tokens.both)).status, 400);
  assert.equal((await request(base, params({ admission_from: '2022-02-30', page: 1 }), tokens.both)).status, 400);
  checks.push('nenhum resultado e rejeição de datas inválidas');
  for (const path of ['/', '/report-pdf', '/report-excel']) assert.equal((await request(base, path, null)).status, 401);
  for (const path of ['/report-pdf', '/report-excel']) {
    assert.equal((await request(base, path, tokens.view)).status, 403);
    assert.equal((await request(base, path, tokens.print)).status, 403);
    assert.equal((await request(base, path, tokens.none)).status, 403);
  }
  assert.equal((await request(base, '/?page=1', tokens.print)).status, 403);
  checks.push('autenticação e permissões de visualização e impressão');
  const pdf = await request(base, `/report-pdf${params(period)}`, tokens.both);
  const excel = await request(base, `/report-excel${params(period)}`, tokens.both);
  assert.equal(pdf.status, 200); assert.equal(excel.status, 200);
  if (process.env.EMPLOYEE_QA_FILES === '1') {
    fs.writeFileSync('tmp/employee-report.pdf', pdf.body);
    fs.writeFileSync('tmp/employee-report.xlsx', excel.body);
  }
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  const pdfjs = await import(pathToFileURL('C:/Users/Win 10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs').href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdf.body), useSystemFonts: true }).promise;
  assert.equal(document.numPages, 1, '25 linhas sintéticas devem caber em uma página compacta');
  let pdfText = '';
  for (let index = 1; index <= document.numPages; index++) pdfText += (await (await document.getPage(index)).getTextContent()).items.map((item) => item.str).join(' ') + ' ';
  for (const row of expected) assert.equal(pdfText.split(row.full_name).length - 1, 1, `PDF divergiu para ${row.full_name}`);
  for (let index = 1; index < expected.length; index++) assert.ok(pdfText.indexOf(expected[index - 1].full_name) < pdfText.indexOf(expected[index].full_name), 'PDF fora da ordem esperada');
  for (const row of [fixtures[0], fixtures[26]]) assert.ok(!pdfText.includes(row.full_name), `PDF incluiu ${row.full_name}`);
  assert.ok(!pdfText.includes(fixtures[1].cpf), 'PDF incluiu CPF');
  assert.ok(pdfText.includes('01/01/2022')); assert.ok(pdfText.includes('31/08/2022'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel.body);
  const sheet = workbook.getWorksheet('Funcionários');
  assert.deepEqual(Array.from({ length: expected.length }, (_, index) => sheet.getCell(`A${index + 7}`).value), expected.map((row) => row.full_name));
  for (let index = 0; index < expected.length; index++) {
    const row = expected[index]; const line = index + 7;
    assert.equal(sheet.getCell(`B${line}`).value.toISOString().slice(0, 10), row.admission_date);
    assert.equal(sheet.getCell(`B${line}`).numFmt, 'dd/mm/yyyy');
    assert.equal(sheet.getCell(`C${line}`).value, row.job_title);
    assert.equal(sheet.getCell(`D${line}`).value, row.sector_name);
    assert.equal(sheet.getCell(`E${line}`).value, row.employment_status === 'ativo' ? 'Ativo' : 'Inativo');
  }
  assert.equal(sheet.getCell('A32').value, null);
  checks.push(`PDF (${document.numPages} páginas) e Excel: exatamente ${expected.length} linhas filtradas, datas e ordem`);

  const { chromium } = await import(pathToFileURL('C:/Users/Win 10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [320, 375, 390, 430, 768, 1365]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${base}/__qa/login`);
    await page.getByRole('heading', { name: 'Funcionários' }).waitFor();
    await page.getByText('27 funcionário(s) encontrado(s)').waitFor();
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    await page.getByLabel('Data de admissão — De').fill('2022-01-01');
    await page.getByLabel('Data de admissão — Até').fill('2022-08-31');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await page.getByText('25 funcionário(s) encontrado(s)').waitFor();
    if (process.env.EMPLOYEE_QA_SCREENSHOTS === '1') await page.screenshot({ path: `tmp/employee-controls-${width}.png` });
    await page.locator('.employees-page .data-table__table tbody tr').first().scrollIntoViewIfNeeded();
    if (process.env.EMPLOYEE_QA_SCREENSHOTS === '1') await page.screenshot({ path: `tmp/employee-list-${width}.png` });
    await page.getByRole('button', { name: 'Próxima' }).click();
    await page.getByText('Página 2 de 2').waitFor();
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
    assert.ok(overflow.document <= 1 && overflow.body <= 1, `${width}px: rolagem horizontal ${JSON.stringify(overflow)}`);
    if (width === 390) {
      for (const name of ['Gerar PDF', 'Exportar Excel']) {
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name }).click();
        assert.match((await download).suggestedFilename(), /relatorio-funcionarios\.(pdf|xlsx)/);
      }
      await page.getByLabel('Buscar por nome').fill('Funcionário 15');
      await page.getByRole('button', { name: 'Aplicar filtros' }).click();
      await page.getByText('1 funcionário(s) encontrado(s)').waitFor();
      await page.getByRole('button', { name: 'Limpar filtros' }).click();
      await page.getByText('27 funcionário(s) encontrado(s)').waitFor();
    }
    visuals.push({ width, filters: true, pagination: true, no_horizontal_scroll: true });
    await context.close();
  }
  console.log(JSON.stringify({ database: databaseName, checks, visuals }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (appPool) await appPool.end();
  if (db) await db.end();
  if (admin._connected) {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`).catch((error) => console.error(`Limpeza do banco isolado falhou: ${error.message}`));
    await admin.end();
  }
}
