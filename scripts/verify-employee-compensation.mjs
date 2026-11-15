import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import jwt from 'jsonwebtoken';
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
  for (const code of ['employees.view', 'employees.profile.print', 'employees.create', 'employees.salary.view', 'employees.salary.manage', 'employees.meal_allowance.view', 'employees.meal_allowance.manage']) permissionIds[code] = (await db.query('INSERT INTO permissions (code) VALUES ($1) RETURNING id', [code])).rows[0].id;
  for (const [role, codes] of [[roleView, ['employees.view']], [rolePrint, ['employees.profile.print']], [roleBoth, ['employees.view', 'employees.profile.print']]]) {
    for (const code of codes) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [role, permissionIds[code]]);
  }
  const userIds = {};
  for (const [name, role] of Object.entries({ view: roleView, print: rolePrint, both: roleBoth, none: roleNone })) {
    userIds[name] = (await db.query("INSERT INTO users (name,username,role,role_id) VALUES ($1,$1,'viewer',$2) RETURNING id", [`qa_${name}`, role])).rows[0].id;
  }
  for (const code of ['employees.create', 'employees.salary.view', 'employees.salary.manage', 'employees.meal_allowance.view', 'employees.meal_allowance.manage']) await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [roleBoth, permissionIds[code]]);
  await db.query(`ALTER TABLE employees ADD COLUMN updated_by uuid, ADD COLUMN updated_at timestamp;
    CREATE TABLE employee_salary_history (id uuid DEFAULT gen_random_uuid(), employee_id uuid, previous_salary numeric(12,2), salary numeric(12,2), effective_from date, reason text, created_by uuid, created_at timestamp DEFAULT now());
    CREATE TABLE employee_meal_allowance_history (id uuid DEFAULT gen_random_uuid(), employee_id uuid, previous_amount numeric(12,2), new_amount numeric(12,2), effective_from date, reason text, created_by uuid, created_at timestamp DEFAULT now());
    CREATE TABLE audit_logs (entity_type text, entity_id uuid, action text, previous_value jsonb, new_value jsonb, user_id uuid);
  `);
  const settings = fs.readFileSync('backend/src/services/companySettingsService.js', 'utf8').match(/const editableFields = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map(x => x.slice(1,-1));
  await db.query(`CREATE TABLE company_settings (id uuid DEFAULT gen_random_uuid(), singleton_key boolean DEFAULT true, logo_path text, created_at timestamp, updated_at timestamp, ${settings.map(x => `${x} text`).join(',')}); INSERT INTO company_settings (nome_fantasia,cnpj) VALUES ('Empresa Fictícia QA','12345678000195')`);
  const employee = (await db.query("INSERT INTO employees (full_name,normalized_name,employment_status,current_salary,meal_allowance,job_title) VALUES ('João da Silva QA','joao da silva qa','ativo',2500,450,'Cargo preservado') RETURNING *")).rows[0];
  const inactive = (await db.query("INSERT INTO employees (full_name,employment_status,current_salary,meal_allowance) VALUES ('Inativo QA','desligado',2500,450) RETURNING id")).rows[0].id;
  const { employeeRoutes } = await import('../backend/src/routes/employeeRoutes.js');
  const { errorMiddleware } = await import('../backend/src/middlewares/errorMiddleware.js');
  const { pool } = await import('../backend/src/database/pool.js'); appPool = pool;
  const { buildAuthUser } = await import('../backend/src/services/permissionService.js');
  const outer = express(); outer.use(express.json());
  outer.get('/__qa/login', async (_req,res) => {
    const user = await buildAuthUser((await db.query('SELECT * FROM users WHERE id=$1',[userIds.both])).rows[0]);
    const token = jwt.sign({id:user.id},process.env.JWT_SECRET);
    res.type('html').send(`<script>localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});location.replace('/funcionarios')</script>`);
  });
  const { authRoutes } = await import('../backend/src/routes/authRoutes.js');
  outer.use('/api/auth', authRoutes);
  outer.use('/api/employees',employeeRoutes); outer.use(errorMiddleware); outer.use(express.static('dist'));
  outer.get('*',(_req,res)=>res.sendFile('index.html',{root:`${process.cwd()}/dist`}));
  await new Promise(resolve=>{server=outer.listen(0,'127.0.0.1',resolve)});
  const base=`http://127.0.0.1:${server.address().port}`;
  const tokens=Object.fromEntries(Object.entries(userIds).map(([name,id])=>[name,jwt.sign({id},process.env.JWT_SECRET)]));
  async function call(path, body, token=tokens.both) {
    const res=await fetch(`${base}/api/employees${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status, data:await res.json()};
  }
  const route=`/${employee.id}/compensation`;
  assert.equal((await call('/compensation/employees',undefined,tokens.view)).status,403);
  assert.equal((await call(route,{current_salary:2800},tokens.view)).status,403);
  assert.equal((await call('/compensation/report?month=11&year=2026',undefined,tokens.view)).status,403);
  assert.equal((await request(base,'/compensation/employees')).status,401);
  assert.equal((await call('/compensation/employees')).data.length,1);
  assert.equal((await call(`/${inactive}/compensation`,{})).status,404);
  const before=await db.query('SELECT * FROM employees WHERE id=$1',[employee.id]);
  for(const body of [{},{current_salary:''},{current_salary:2500,meal_allowance:450}]) assert.equal((await call(route,body)).data.changes.length,0);
  for(const body of [{current_salary:2400},{meal_allowance:400},{current_salary:-1},{job_title:'Alterado'},{current_salary:2800,expected:{current_salary:2400}},{effective_from:'2026-02-30'}]) assert.ok((await call(route,body)).status>=400);
  assert.deepEqual((await db.query('SELECT * FROM employees WHERE id=$1',[employee.id])).rows,before.rows);
  assert.equal((await call(route,{current_salary:2800,expected:{current_salary:2500},effective_from:'2026-12-01'})).data.changes.length,1);
  assert.equal((await call(route,{meal_allowance:500,expected:{meal_allowance:450}})).data.changes.length,1);
  const both={current_salary:3000,meal_allowance:550,expected:{current_salary:2800,meal_allowance:500}};
  const repeated=await Promise.all([call(route,both),call(route,both)]);
  assert.deepEqual(repeated.map(x=>x.data.changes.length).sort(),[0,2]);
  assert.equal(Number((await db.query('SELECT count(*) FROM audit_logs')).rows[0].count),4);
  assert.equal((await db.query('SELECT job_title FROM employees WHERE id=$1',[employee.id])).rows[0].job_title,'Cargo preservado');
  const now = (await db.query('SELECT extract(month from now()) AS month, extract(year from now()) AS year')).rows[0];
  const reportPath=`/compensation/report?month=${now.month}&year=${now.year}`;
  assert.equal((await call(reportPath)).data.rows.length,4);
  assert.equal((await call('/compensation/report?month=1&year=1900')).data.rows.length,0);
  // Inject a failure to prove both changes and histories roll back together.
  await db.query(`CREATE FUNCTION reject_meal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA rollback'; END $$; CREATE TRIGGER reject_meal BEFORE INSERT ON employee_meal_allowance_history FOR EACH ROW EXECUTE FUNCTION reject_meal()`);
  assert.equal((await call(route,{current_salary:3100,meal_allowance:600,expected:{current_salary:3000,meal_allowance:550}})).status,500);
  assert.equal(Number((await db.query('SELECT current_salary FROM employees WHERE id=$1',[employee.id])).rows[0].current_salary),3000);
  await db.query('DROP TRIGGER reject_meal ON employee_meal_allowance_history');
  fs.mkdirSync('tmp/compensation',{recursive:true});
  const pdf=await request(base,reportPath.replace('/report?','/report-pdf?'),tokens.both); assert.equal(pdf.status,200);
  fs.writeFileSync('tmp/compensation/report.pdf',pdf.body);
  checks.push('API autenticada, permissões, campos vazios/iguais, reduções, preservação, aumentos separados/ambos, concorrência, rollback, histórico, relatório e PDF');
  const { chromium }=await import(pathToFileURL('C:/Users/Win 10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const width of [390,768,1365]) {
    const context=await browser.newContext({viewport:{width,height:1024}}); const page=await context.newPage();
    const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(`${base}/__qa/login`); await page.getByRole('heading',{name:'Funcionários',exact:true}).waitFor();
    await page.screenshot({path:`tmp/compensation/header-${width}.png`});
    await page.getByRole('button',{name:'Atualização cadastral',exact:true}).click();
    await page.getByLabel('Buscar funcionário por nome').fill('joao');
    await page.getByLabel('Funcionário ativo',{exact:true}).selectOption(employee.id);
    await page.getByLabel('Salário atual',{exact:true}).waitFor();
    await page.getByLabel('Atualizar salário',{exact:true}).check();
    await page.getByLabel('Novo salário',{exact:true}).fill('3.200,00');
    await page.getByLabel('Atualizar salário',{exact:true}).uncheck();
    await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
    await page.getByText('Nenhuma alteração realizada.',{exact:true}).waitFor();
    await page.getByLabel('Atualizar salário',{exact:true}).check();
    await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
    await page.getByRole('button',{name:'Confirmar e salvar',exact:true}).waitFor();
    await page.screenshot({path:`tmp/compensation/modal-${width}.png`});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator('.compensation-modal').evaluate(e=>e.scrollWidth<=e.clientWidth));
    await page.getByRole('button',{name:'Voltar e revisar',exact:true}).click();
    if(width===390) {
      await page.getByLabel('Novo salário',{exact:true}).fill('2.000,00');
      await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
      await page.getByText('O novo valor deve ser maior que o atual.',{exact:true}).waitFor();
      await page.getByLabel('Novo salário',{exact:true}).fill('');
      await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
      await page.getByText('Nenhuma alteração realizada.',{exact:true}).waitFor();
    }
    if(width===1365) {
      await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
      await page.getByRole('button',{name:'Confirmar e salvar',exact:true}).click();
      await page.getByText('Alterações salvas com sucesso.',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Salário atual',{exact:true}).inputValue(), 'R$ 3.200,00');
      await page.getByRole('button',{name:'Consultar alterações',exact:true}).click();
      await page.getByText('João da Silva QA — Salário',{exact:true}).first().waitFor();
      const downloaded=page.waitForEvent('download');
      await page.locator('.compensation-report').getByRole('button',{name:'Gerar PDF',exact:true}).click();
      assert.match((await downloaded).suggestedFilename(),/modificacoes-/);
    }
    assert.deepEqual(pageErrors,[]); visuals.push({width,noOverflow:true,confirmation:true,uncheckedNoChange:true}); await context.close();
  }
  console.log(JSON.stringify({checks,visuals},null,2));
} finally {
  if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve));
  if(appPool) await appPool.end(); if(db) await db.end();
  if(admin._connected) { await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.end(); }
}
