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


 const {quoteProductionTaskName,correctQuoteProductionNames}=await import('../backend/src/services/quoteProductionTaskNameService.js');
 const {setTaskStatus}=await import('../backend/src/controllers/taskController.js');
 const root=node(null,'Eixo Universal H-2 QA',{sector_id:sectorA});
 const rootPlan={enabled:true,nodes:[root]};
 const body=plan=>({customer_name:'Cliente fictício nomes',quote_date:'2026-11-27',promised_date:'2031-08-01',manufacturing_enabled:true,items:[{name:'Eixo Universal H-2 QA',unit:'UN',save_product:false,quantity:1,unit_price:100,manufacturing_plan:plan}],payment_methods:[{method_type:'pix',calculation_type:'percentage',percentage:'100',installment_count:1}]});
 const review=q=>transaction(c=>manufacturingReview(c,q.id));
 const convert=async(q,manufacture=true)=>changeCommercialQuoteStatus(q.id,'approved',actor,{manufacture,confirmed:true,expected_updated_at:(await getCommercialQuote(q.id)).updated_at});
 const tasks=async q=>(await db.query('SELECT t.* FROM internal_tasks t JOIN sold_items si ON si.id=t.sold_item_id JOIN internal_orders io ON io.id=si.internal_order_id WHERE io.commercial_quote_id=$1 ORDER BY t.id',[q.id])).rows;
 const correct=async(q,extra={},who=actor)=>{const r=await review(q);return correctQuoteProductionNames(q.id,{confirmed:true,expected_updated_at:r.updated_at,expected_order_updated_at:r.order_updated_at,...extra},who);};
 const single=await createCommercialQuote(body(rootPlan),actor);await convert(single);let t=await tasks(single);
 assert.equal(t.length,1);assert.equal(t[0].task_name,root.new_product.name);assert.equal(Number(t[0].quantity),1);
 await convert(single);assert.equal((await tasks(single)).length,1);
 const child=node(root.key,'Carcaça QA',{sector_id:sectorB}),sub=node(child.key,'Eixo interno QA',{sector_id:sectorC});
 const composed=await createCommercialQuote(body({enabled:true,nodes:[root,child,sub]}),actor);await convert(composed);let composedTasks=await tasks(composed);
 assert.equal(composedTasks.length,3);assert.equal(composedTasks.find(x=>x.manufacturing_node_key===root.key).task_name,root.new_product.name);
 assert.equal(composedTasks.find(x=>x.manufacturing_node_key===child.key).task_name,'Carcaça QA');
 assert.equal(composedTasks.find(x=>x.manufacturing_node_key===sub.key).task_name,'Eixo interno QA');
 assert.equal(composedTasks.filter(x=>x.is_released).length,1);
 const edgeRows=async q=>(await db.query('SELECT d.* FROM internal_task_dependencies d JOIN internal_tasks t ON t.id=d.task_id JOIN sold_items si ON si.id=t.sold_item_id JOIN internal_orders io ON io.id=si.internal_order_id WHERE io.commercial_quote_id=$1 ORDER BY d.id',[q.id])).rows;
 const composedEdges=await edgeRows(composed);assert.equal(composedEdges.length,2);
 const withoutRoot=await createCommercialQuote(body({enabled:true,nodes:[{...root,manufacture:false},child,sub]}),actor);await convert(withoutRoot);const withoutTasks=await tasks(withoutRoot);
 assert.equal(withoutTasks.length,2);assert.ok(!withoutTasks.some(x=>x.manufacturing_node_key===root.key));assert.equal((await edgeRows(withoutRoot)).length,1);
 for(const controls of [{manufacturing_enabled:false},{planDisabled:true}]){
   const b=body({...rootPlan,enabled:!controls.planDisabled});if(controls.manufacturing_enabled===false)b.manufacturing_enabled=false;
   const q=await createCommercialQuote(b,actor);assert.equal((await review(q)).demands.length,0);await convert(q,false);assert.equal((await tasks(q)).length,0);
 }
 // Reproduce the old string on both pending and completed tasks, then repair only this quote.
 const original=t[0];await db.query('UPDATE internal_tasks SET task_name=$1 WHERE id=$2',[original.manufacturing_snapshot.name+' — '+original.manufacturing_snapshot.root_name,original.id]);
 let failure;await setTaskStatus({path:'/tasks/'+original.id+'/ready',params:{id:original.id},user:actor},{json(){}},e=>failure=e);if(failure)throw failure;
 const before=(await tasks(single))[0],beforePlan=(await getCommercialQuote(single.id)).items[0].manufacturing_plan;
 const beforeOrder=(await db.query('SELECT * FROM internal_orders WHERE commercial_quote_id=$1',[single.id])).rows[0];
 const auditBefore=(await db.query("SELECT id FROM audit_logs WHERE entity_type='internal_task' AND entity_id=$1 ORDER BY id",[original.id])).rows;
 await assert.rejects(correct(single,{confirmed:false}),{status:400});await assert.rejects(correct(single,{}, {id:viewer.id,permissions:['commercial.quotes.edit']}),{status:403});
 const result=await correct(single);assert.equal(result.corrected,1);const after=(await tasks(single))[0];
 const stableTask=({task_name,updated_at,...rest})=>rest;assert.deepEqual(stableTask(after),stableTask(before));assert.equal(after.task_name,root.new_product.name);
 const afterOrder=(await db.query('SELECT * FROM internal_orders WHERE commercial_quote_id=$1',[single.id])).rows[0];const stableOrder=({updated_at,...rest})=>rest;assert.deepEqual(stableOrder(afterOrder),stableOrder(beforeOrder));
 assert.deepEqual((await getCommercialQuote(single.id)).items[0].manufacturing_plan,beforePlan);
 for(const entry of auditBefore)assert.ok((await db.query('SELECT 1 FROM audit_logs WHERE id=$1',[entry.id])).rowCount);
 assert.equal((await correct(single)).corrected,0);assert.equal((await tasks(single)).length,1);
 assert.deepEqual(await tasks(composed),composedTasks,'Other orders are never touched');
 // Correct every tree-linked level; node identity is authoritative inside the commercial flow.
 const composedRoot=composedTasks.find(x=>x.manufacturing_node_key===root.key);
 for(const task of composedTasks)await db.query('UPDATE internal_tasks SET task_name=$1 WHERE id=$2',[task.manufacturing_snapshot.name+' — '+task.manufacturing_snapshot.root_name,task.id]);
 const subTask=composedTasks.find(x=>x.manufacturing_node_key===sub.key);
 let completionError;await setTaskStatus({path:'/tasks/'+subTask.id+'/ready',params:{id:subTask.id},user:actor},{json(){}},e=>completionError=e);if(completionError)throw completionError;
 composedTasks=await tasks(composed);
 const custom=(await createCommercialQuote(body(rootPlan),actor));await convert(custom);const customTask=(await tasks(custom))[0];await db.query("UPDATE internal_tasks SET task_name='Identificação manual preservada' WHERE id=$1",[customTask.id]);assert.equal((await correct(custom)).corrected,1);assert.equal((await tasks(custom))[0].task_name,root.new_product.name);
 assert.equal(quoteProductionTaskName({name:'Componente distinto',root_name:'Produto final',parent_key:'pai'}),'Componente distinto');
 const {app}=await import('../backend/src/app.js');const outer=express();
 outer.get('/__qa/login',(_req,res)=>res.type('html').send('<script>localStorage.setItem("token",'+JSON.stringify(jwt.sign({id:user.id},process.env.JWT_SECRET))+');localStorage.setItem("user",'+JSON.stringify(JSON.stringify(actor))+');location.replace("/comercial/orcamentos/'+composed.id+'")</script>'));
 outer.use(app);outer.use(express.static('tmp/quote-manufacturing-build'));outer.get('*',(_req,res)=>res.sendFile('index.html',{root:process.cwd()+'/tmp/quote-manufacturing-build'}));
 await new Promise(resolve=>{server=outer.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import(pathToFileURL('C:/Users/Win 10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1365,height:1000}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('tmp/quote-task-names',{recursive:true});
 await page.goto(base+'/__qa/login');await page.getByRole('button',{name:'Corrigir nomes das demandas',exact:true}).click();
 const response=page.waitForResponse(r=>r.url().endsWith('/manufacturing/correct-names')&&r.request().method()==='POST');await page.getByRole('button',{name:'Confirmar correção dos nomes',exact:true}).click();const correctionResponse=await response;assert.equal(correctionResponse.status(),200);assert.equal((await correctionResponse.json()).corrected,3);
 const finalTasks=await tasks(composed);assert.equal(finalTasks.length,3);assert.equal(finalTasks.find(x=>x.id===composedRoot.id).task_name,root.new_product.name);assert.deepEqual(await edgeRows(composed),composedEdges);
 for(const task of composedTasks){const corrected=finalTasks.find(x=>x.id===task.id);assert.equal(corrected.task_name,task.manufacturing_snapshot.name);assert.deepEqual(stableTask(corrected),stableTask(task));}
 // Finish dependencies after text repair: the original edges release the parent normally.
 for(const key of [child.key,root.key]){const task=(await tasks(composed)).find(x=>x.manufacturing_node_key===key);assert.equal(task.is_released,true);let error;await setTaskStatus({path:'/tasks/'+task.id+'/ready',params:{id:task.id},user:actor},{json(){}},e=>error=e);if(error)throw error;}
 assert.ok((await tasks(composed)).every(t=>t.status==='ready'));assert.equal((await correct(composed)).corrected,0);
 // Unreliable links and manual tasks cannot be renamed by this correction.
 const unreliable=await createCommercialQuote(body(rootPlan),actor);await convert(unreliable);const untrusted=(await tasks(unreliable))[0];
 await db.query('UPDATE internal_tasks SET task_name=$1 WHERE id=$2',[untrusted.manufacturing_snapshot.name+' — '+untrusted.manufacturing_snapshot.root_name,untrusted.id]);
 await db.query(`UPDATE commercial_quote_items SET manufacturing_plan=jsonb_set(manufacturing_plan,'{nodes,0,new_product,name}',to_jsonb('Outro nome sem correspondência'::text)) WHERE commercial_quote_id=$1`,[unreliable.id]);
 assert.equal((await correct(unreliable)).corrected,0);
 const manual=(await db.query(`INSERT INTO internal_tasks(sold_item_id,sector_id,task_name,quantity) VALUES($1,$2,'Manual — Produto final',1) RETURNING *`,[original.sold_item_id,sectorA])).rows[0];
 assert.equal((await correct(single)).corrected,0);assert.deepEqual((await db.query('SELECT * FROM internal_tasks WHERE id=$1',[manual.id])).rows[0],manual);
 const auth={Authorization:'Bearer '+jwt.sign({id:user.id},process.env.JWT_SECRET)};
 const tv=await (await fetch(base+'/api/tv',{headers:auth})).json();for(const task of await tasks(composed))assert.ok(!tv.some(x=>x.task_id===task.id),'Completed tasks stay outside the existing TV queue');
 await page.screenshot({path:'tmp/quote-task-names/corrected.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: node-only names at root/component/subcomponent; targeted pending/completed repair with verified tree links; sequential release after correction; manual/unreliable records excluded; IDs, dates, priorities, progress, snapshots, quantities, sectors, dependencies and audit preserved; idempotent repair and real UI action');
} catch(error) {
 if(browser)for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:'tmp/quote-task-names/failure.png',fullPage:true}).catch(()=>{});console.error((await p.locator('body').innerText()).slice(-2500));}throw error;
} finally {
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(appPool)await appPool.end();if(db)await db.end();
 await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[databaseName]).catch(()=>{});await admin.query('DROP DATABASE IF EXISTS '+databaseName).catch(()=>{});await admin.end();
}
