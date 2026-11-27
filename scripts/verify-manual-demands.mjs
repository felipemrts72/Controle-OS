import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import express from 'express';
import { requiredQuantities, multiplyProduction } from '../src/utils/manufacturingQuantities.js';
const source=new URL(dotenv.parse(fs.readFileSync('.env')).DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(source.hostname));
const databaseName=`qa_quote_manufacturing_${randomBytes(5).toString('hex')}`;
const adminUrl=new URL(source);adminUrl.hostname='127.0.0.1';adminUrl.pathname='/postgres';
const testUrl=new URL(adminUrl);testUrl.pathname=`/${databaseName}`;
const admin=new pg.Client({connectionString:adminUrl.toString()});
let db,appPool,server,browser;
const node=(parent,name,extra={})=>({key:randomUUID(),parent_key:parent,new_product:{name,type:'manufactured'},quantity:'1',unit_code:'UN',...extra});
try {
 await admin.connect();await admin.query(`CREATE DATABASE ${databaseName}`);
 db=new pg.Pool({connectionString:testUrl.toString()});
 const schema=execFileSync((process.env.PG_BIN||'C:/Program Files/PostgreSQL/18/bin')+'/pg_dump.exe',['-h','127.0.0.1','-p',source.port||'5432','-U',decodeURIComponent(source.username),'-d',decodeURIComponent(source.pathname.slice(1)),'--schema-only','--no-owner','--no-privileges'],{env:{...process.env,PGPASSWORD:decodeURIComponent(source.password)},encoding:'utf8',maxBuffer:32e6}).replace(/^\\.*$/gm,'');
 await db.query(schema);await db.query('SET search_path TO public');
 if (!(await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='commercial_quotes' AND column_name='manufacturing_enabled'")).rowCount) await db.query(fs.readFileSync('database/migrations/20261125_quote_manufacturing.sql','utf8'));
 if (!(await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='internal_tasks' AND column_name='completed_quantity'")).rowCount) await db.query(fs.readFileSync('database/migrations/20261126_quote_production_dependencies.sql','utf8'));
 await db.query("INSERT INTO product_types(code,name,is_active) VALUES('manufactured','Fabricado',true),('resale','Peça comprada',true),('material_prima','Matéria-prima',true)");
 await db.query("INSERT INTO measurement_units(code,name,symbol,is_active) VALUES('UN','Unidade','un',true),('KG','Quilograma','kg',true)");
 const user=(await db.query("INSERT INTO users(name,username,password_hash,role) VALUES('Administrador fictício','admin','unused','admin') RETURNING *")).rows[0];
 const viewer=(await db.query("INSERT INTO users(name,username,password_hash,role) VALUES('Sem permissão','qa_viewer','unused','viewer') RETURNING *")).rows[0];
 const sectorA=(await db.query("INSERT INTO sectors(name,slug) VALUES('Usinagem QA','usinagem') RETURNING id")).rows[0].id;
 const sectorB=(await db.query("INSERT INTO sectors(name,slug) VALUES('Montagem QA','montagem') RETURNING id")).rows[0].id;
 const sectorC=(await db.query("INSERT INTO sectors(name,slug) VALUES('Pintura QA','pintura') RETURNING id")).rows[0].id;
 if (!(await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='commercial_quotes' AND column_name='promised_date'")).rowCount) await db.query(fs.readFileSync('database/migrations/20261127_quote_promised_date.sql','utf8'));
 process.env.DATABASE_URL=testUrl.toString();process.env.JWT_SECRET=randomBytes(24).toString('hex');
 const {pool,transaction}=await import('../backend/src/database/pool.js');appPool=pool;
 const {buildAuthUser}=await import('../backend/src/services/permissionService.js');const actor=await buildAuthUser(user);
 const {saveProductTree,getProductTree}=await import('../backend/src/services/productTreeService.js');
 const {manufacturingTemplate,manufacturingReview,issueQuoteManufacturing,normalizeManufacturingPlan,saveApprovedQuotePlanning}=await import('../backend/src/services/quoteManufacturingService.js');
 const {createCommercialQuote,getCommercialQuote,updateCommercialQuote,changeCommercialQuoteStatus,emitCommercialQuote}=await import('../backend/src/services/commercialQuoteService.js');

 await db.query("UPDATE sectors SET name='Compras QA',slug='compras' WHERE id=$1",[sectorB]);
 await db.query("INSERT INTO product_types(code,name,is_active) VALUES('purchased','Comprado QA',true),('qa_other','Outro QA',true)");
 const root=node(null,'Equipamento fictício',{sector_id:sectorA});
 const types=['resale','material_prima','purchased','qa_other'];
 const children=types.map(type=>node(root.key,'Componente fictício '+type,{new_product:{name:'Componente fictício '+type,type},quantity:'2',sector_id:sectorB}));
 const stock=await saveProductTree(null,{request_id:randomUUID(),version:0,nodes:[root,...children]},actor);
 const plan=await transaction(c=>manufacturingTemplate(c,{product_id:stock.product_id}));
 const body={customer_name:'Cliente fictício seleção manual',promised_date:'2031-05-11',quote_date:'2026-11-27',manufacturing_enabled:true,items:[{product_id:stock.product_id,quantity:'1',unit_price:'100',manufacturing_plan:plan}],payment_methods:[{method_type:'pix',calculation_type:'percentage',percentage:'100',installment_count:1}]};
 const quote=await createCommercialQuote(body,actor);
 const review=()=>transaction(c=>manufacturingReview(c,quote.id));
 assert.equal((await review()).demands.length,1,'Only manufactured root defaults to selected');
 const {app}=await import('../backend/src/app.js');const outer=express();
 outer.get('/__qa/login',(_req,res)=>res.type('html').send('<script>localStorage.setItem("token",'+JSON.stringify(jwt.sign({id:user.id},process.env.JWT_SECRET))+');localStorage.setItem("user",'+JSON.stringify(JSON.stringify(actor))+');location.replace("/comercial/orcamentos/'+quote.id+'/editar")</script>'));
 outer.use(app);outer.use(express.static('tmp/quote-manufacturing-build'));outer.get('*',(_req,res)=>res.sendFile('index.html',{root:process.cwd()+'/tmp/quote-manufacturing-build'}));
 await new Promise(resolve=>{server=outer.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port;
 const auth={Authorization:'Bearer '+jwt.sign({id:user.id},process.env.JWT_SECRET)};
 const {chromium}=await import(pathToFileURL('C:/Users/Win 10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1365,height:1000}});page.setDefaultTimeout(12000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('tmp/manual-demands',{recursive:true});
 await page.goto(base+'/__qa/login');await page.getByRole('button',{name:'Lançar processo de fabricação',exact:true}).click();
 const card=type=>page.locator('.product-tree__node').filter({has:page.locator('strong',{hasText:'Componente fictício '+type})});
 for(const type of types) {
   const c=card(type),check=c.getByLabel('Gerar demanda',{exact:true});
   assert.equal(await check.isChecked(),false);assert.equal(await check.isEnabled(),true);
   await check.check();assert.equal(await check.isChecked(),true);
   await check.uncheck();assert.equal(await check.isChecked(),false);await check.check();
   await c.getByLabel('Quantidade a fabricar').fill('2');
 }
 // Editing other node fields must preserve its manual selection and quantity.
 await card('resale').getByRole('button',{name:'Editar',exact:true}).click();
 await page.locator('.product-tree__modal textarea').fill('Demanda operacional fictícia de compras');
 await page.getByRole('button',{name:'Aplicar ao rascunho',exact:true}).click();
 assert.equal(await card('resale').getByLabel('Gerar demanda',{exact:true}).isChecked(),true);
 // A purchased node explicitly deselected must not create a task or dependency.
 await card('purchased').getByLabel('Gerar demanda',{exact:true}).uncheck();
 assert.equal(await page.getByLabel('Salvar também a árvore no cadastro do produto').isChecked(),false);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/commercial/quotes/'+quote.id)&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Salvar orçamento e planejamento',exact:true}).click();assert.equal((await saved).status(),200);
 await page.getByRole('link',{name:'Editar',exact:true}).click();await page.getByRole('button',{name:'Lançar processo de fabricação',exact:true}).click();
 for(const type of types)assert.equal(await card(type).getByLabel('Gerar demanda',{exact:true}).isChecked(),type!=='purchased');
 assert.equal(await card('resale').getByLabel('Quantidade a fabricar').inputValue(),'2');
 await page.screenshot({path:'tmp/manual-demands/selection.png',fullPage:true});
 await page.getByRole('button',{name:'Voltar ao orçamento',exact:true}).click();await page.getByRole('link',{name:'Voltar',exact:true}).click();
 const persisted=await getCommercialQuote(quote.id),nodes=persisted.items[0].manufacturing_plan.nodes;
 for(const type of types){const n=nodes.find(n=>n.type===type);assert.equal(n.manufacture,type!=='purchased');assert.equal(n.sector_id,sectorB);}
 assert.equal(nodes.find(n=>n.type==='resale').note,'Demanda operacional fictícia de compras');
 assert.deepEqual(await getProductTree(stock.product_id,actor),stock,'Quote planning never changes the product tree');
 const r=await review();assert.deepEqual(r.errors,[]);assert.equal(r.demands.length,4);
 assert.equal(r.demands.find(d=>d.node_key===root.key).dependencies.length,3);
 await page.getByRole('button',{name:'Converter em venda',exact:true}).click();
 await page.getByLabel('Gerar ordem de produção',{exact:true}).waitFor();
 const converted=page.waitForResponse(r=>r.url().endsWith('/status')&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'Confirmar conversão em venda',exact:true}).click();assert.equal((await converted).status(),200);
 const approved=await getCommercialQuote(quote.id),order=approved.sale.production_order_id;assert.ok(order);
 const tasks=(await db.query('SELECT t.* FROM internal_tasks t JOIN sold_items si ON si.id=t.sold_item_id WHERE si.internal_order_id=$1',[order])).rows;
 assert.equal(tasks.length,4);assert.equal(tasks.filter(t=>t.is_released).length,3);
 assert.ok(!tasks.some(t=>t.manufacturing_node_key===children[2].key));
 const parent=tasks.find(t=>t.manufacturing_node_key===root.key);assert.equal(parent.is_released,false);
 const tv=await (await fetch(base+'/api/tv/compras',{headers:auth})).json();assert.equal(tv.length,3);
 for(const task of tasks.filter(t=>t.id!==parent.id)){
   assert.equal(task.sector_id,sectorB);assert.equal(Number(task.quantity),2);assert.ok(tv.some(t=>t.task_id===task.id));
   const result=await fetch(base+'/api/tasks/'+task.id+'/ready',{method:'PATCH',headers:auth});assert.equal(result.status,200);
 }
 assert.equal((await db.query('SELECT is_released FROM internal_tasks WHERE id=$1',[parent.id])).rows[0].is_released,true);
 assert.equal((await (await fetch(base+'/api/tv/compras',{headers:auth})).json()).length,0);
 const released=await (await fetch(base+'/api/tv/usinagem',{headers:auth})).json();assert.ok(released.some(t=>t.task_id===parent.id));
 assert.deepEqual(errors,[]);
 console.log('PASS: manual toggles for resale/material/purchased/other, edit/save/reopen persistence, unchanged product classification/tree, conversion, quantities, sector TV, selected dependencies and deselected exclusions');
} catch(error) {
 if(browser) for(const c of browser.contexts()) for(const p of c.pages()) {await p.screenshot({path:'tmp/manual-demands/failure.png',fullPage:true}).catch(()=>{});console.error((await p.locator('body').innerText()).slice(-3000));}
 throw error;
} finally {
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(appPool)await appPool.end();if(db)await db.end();
 await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[databaseName]).catch(()=>{});await admin.query('DROP DATABASE IF EXISTS '+databaseName).catch(()=>{});await admin.end();
}
