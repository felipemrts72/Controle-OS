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
const databaseName = `qa_pagamentos_${randomBytes(4).toString('hex')}`;
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
    CREATE TABLE employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, normalized_name text, cpf text, job_title text, sector_id uuid, admission_date date, employment_status text, registration_type text DEFAULT 'quick', profile_completed boolean DEFAULT true, current_salary numeric, meal_allowance numeric, created_at timestamp DEFAULT now(), deleted_at timestamp, pix_key text);`);
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
  await db.query(fs.readFileSync('database/migrations/20261117_employee_payments.sql','utf8'));
  await db.query(fs.readFileSync('database/migrations/20261123_employee_payment_updates.sql','utf8'));
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

  const { savePayment, getPayment, finalizePayment, listPayments } = await import('../backend/src/services/employeePaymentService.js');
  const user=userIds.both;
  const second=(await db.query("INSERT INTO employees (full_name,employment_status,pix_key) VALUES ('Maria QA','ativo','  chave.exata@example.invalid  ') RETURNING id")).rows[0].id;
  const items=[{employee_id:employee.id,amount_cents:10001},{employee_id:second,amount_cents:20002}];
  assert.equal((await call('/payments',undefined,tokens.view)).status,403);
  assert.equal((await request(base,'/payments')).status,401);
  assert.equal((await call('/payments',{items},tokens.print)).status,403);
  assert.equal((await call('/payments/employees')).data.length,2);
  for(const invalid of [[items[0],items[0]],[{...items[0],amount_cents:0}],[{...items[0],amount_cents:1.5}]]) await assert.rejects(savePayment(null,{items:invalid},user));
  let draft=await savePayment(null,{items},user);
  assert.equal(Number(draft.total_cents),30003);
  assert.deepEqual((await getPayment(String(draft.id))).items,draft.items);
  await assert.rejects(finalizePayment(String(draft.id),draft.version,user),/Pix pendentes/);
  await db.query('UPDATE employees SET pix_key=$1 WHERE id=$2',['12345678901',employee.id]);
  draft=await savePayment(String(draft.id),{version:draft.version,items:[items[0]]},user);
  assert.equal(draft.employee_count,1);
  draft=await savePayment(String(draft.id),{version:draft.version,items},user);
  assert.equal(draft.updated_by,user);
  await db.query("CREATE FUNCTION fail_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='finalize' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_payment_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_payment_audit()");
  await assert.rejects(finalizePayment(String(draft.id),draft.version,user),/QA rollback/);
  assert.equal((await getPayment(String(draft.id))).finalized_at,null);
  await db.query('DROP TRIGGER fail_payment_audit ON audit_logs');
  const results=await Promise.all([finalizePayment(String(draft.id),draft.version,user),finalizePayment(String(draft.id),draft.version,user)]);
  assert.equal(results[0].finalized_at.getTime(),results[1].finalized_at.getTime());
  assert.equal((await db.query("SELECT * FROM audit_logs WHERE action='finalize'")).rowCount,1);
  await db.query('UPDATE employees SET pix_key=$1 WHERE id=$2',['alterada',second]);
  const final=await getPayment(String(draft.id));
  assert.equal(final.items[1].pix_key,'  chave.exata@example.invalid  ');
  await assert.rejects(savePayment(String(draft.id),{version:final.version,items},user),{status:409});
  assert.equal((await listPayments()).length,1);
  const before=(await db.query('SELECT current_salary,meal_allowance FROM employees WHERE id=$1',[employee.id])).rows[0];
  assert.equal(Number(before.current_salary),2500); assert.equal(Number(before.meal_allowance),450);
  fs.mkdirSync('tmp/payments',{recursive:true});
  const { buildPaymentPdf }=await import('../backend/src/controllers/employeePaymentController.js');
  const many=Array.from({length:80},(_,i)=>({...final.items[i%2],full_name:'Funcionário fictício '+i,pix_key:i%2?'a'.repeat(100)+'@example.invalid':'12345678-1234-1234-1234-123456789012'}));
  fs.writeFileSync('tmp/payments/pix.pdf',await buildPaymentPdf({...final,items:many,total_cents:many.reduce((s,r)=>s+r.amount_cents,0)},{razao_social:'Empresa fictícia'}));
  const { buildVacationProgrammedReportPdf }=await import('../backend/src/services/pdf/vacationProgrammedReportPdfService.js');
  fs.writeFileSync('tmp/payments/vacations.pdf',await buildVacationProgrammedReportPdf({company:{razao_social:'Empresa fictícia'},rows:Array.from({length:18},(_,i)=>({id:i,employee_id:i%3,period_id:i,full_name:'Funcionário fictício '+(i%3),job_title:'Operador',start_date:'2026-12-01',end_date:'2026-12-20',days:20,bonus_days:10,acquisition_start:i%2?'2024-12-12':'2025-12-12',acquisition_end:i%2?'2025-12-11':'2026-12-11'}))}));
  const { chromium }=await import(pathToFileURL('C:/Users/Win 10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const width of [390,768,1365]) {
    const context=await browser.newContext({viewport:{width,height:1024}}); const page=await context.newPage();
    await page.goto(base+'/__qa/login');
    await page.getByRole('button',{name:'Pagamentos',exact:true}).click();
    await page.getByRole('button',{name:'Novo pagamento',exact:true}).click();
    await page.getByRole('region',{name:'Pagamentos de funcionários'}).getByLabel('Buscar por nome').fill('João');
    await page.locator('.employee-payments select').selectOption(employee.id);
    await page.getByLabel('Valor em reais',{exact:true}).fill('1.234,56');
    await page.getByRole('button',{name:'Adicionar funcionário',exact:true}).click();
    await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();
    await page.getByText('Rascunho salvo.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Finalizar pagamento',exact:true}).click();
    await page.getByRole('button',{name:'Confirmar finalização',exact:true}).waitFor();
    await page.screenshot({path:'tmp/payments/review-'+width+'.png'});
    assert.ok(await page.locator('.employee-payments').evaluate(e=>e.scrollWidth<=e.clientWidth));
    await page.getByRole('button',{name:'Confirmar finalização',exact:true}).click();
    await page.getByText('Relação preparada e confirmada.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Salvar rascunho',exact:true}).count(),0);
    await context.close();
  }
  console.log('PASS: banco isolado, persistência, edição, duplicados, valores, permissões, concorrência, Pix preservado, histórico, PDFs, UI 390/768/1365');
} finally {
  if(browser) await browser.close(); if(server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
  if(appPool) await appPool.end(); if(db) await db.end();
  if(admin._connected) { await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.end(); }
}
