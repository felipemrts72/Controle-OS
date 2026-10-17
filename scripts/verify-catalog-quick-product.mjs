import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import {pool} from '../backend/src/database/pool.js';
import {buildAuthUser} from '../backend/src/services/permissionService.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/Win%2010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const host='https://os.torneadorauniversal.com.br';let browser,cp,product;
try {
 const admin=(await pool.query("SELECT u.*,r.slug role_slug FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.is_active AND u.approval_status='approved' LIMIT 1")).rows[0];
 const user=await buildAuthUser(admin);const token=jwt.sign({id:user.id},process.env.JWT_SECRET||'dev-secret',{expiresIn:'10m'});
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 const name=`Teste controlado catálogo ${Date.now()}`;
 const response=await fetch(`${host}/api/commercial/catalog/products`,{method:'POST',headers,body:JSON.stringify({name,reference_price:''})});assert.equal(response.status,201);cp=await response.json();
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 await page.addInitScript(({token,user})=>{localStorage.setItem('token',token);localStorage.setItem('user',JSON.stringify(user));},{token,user});
 await page.goto(`${host}/comercial/catalogo/${cp.commercial_product_id}`);
 await page.getByRole('button',{name:'Criar Produto do Estoque',exact:true}).click();
 assert.equal(await page.getByLabel('Nome do produto operacional').inputValue(),name);
 const sector=(await pool.query('SELECT id FROM sectors WHERE is_active ORDER BY name LIMIT 1')).rows[0];
 await page.getByLabel('Setor do produto operacional').selectOption(sector.id);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/commercial/catalog/operational-products')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Criar e selecionar',exact:true}).click();
 const r=await saved;assert.equal(r.status(),200);product=await r.json();
 await page.getByText('Produto criado e selecionado. Pendente de revisão.',{exact:true}).waitFor();
 assert.equal(await page.locator('.catalog-editor__operational select').inputValue(),product.id);
 await page.reload();await page.getByLabel('Nome comercial *',{exact:true}).waitFor();
 assert.equal(await page.locator('.catalog-editor__operational select').inputValue(),product.id);
 assert.equal(await page.getByLabel('Código comercial',{exact:true}).inputValue(),String(cp.commercial_number));
 const db=(await pool.query('SELECT * FROM products WHERE id=$1',[product.id])).rows[0];assert.equal(db.review_status,'pending_review');assert.equal(db.sector_id,sector.id);
 const references=(await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name='product_id' AND table_name<> 'product_catalogs'")).rows;
 const counts={};for(const {table_name,column_name} of references){assert.match(table_name,/^[a-z_]+$/);counts[table_name]=Number((await pool.query(`SELECT count(*) n FROM ${table_name} WHERE ${column_name}=$1`,[product.id])).rows[0].n);assert.equal(counts[table_name],0,table_name);}
 assert.equal((await pool.query('SELECT operational_product_id FROM commercial_products WHERE id=$1',[cp.commercial_product_id])).rows[0].operational_product_id,product.id);
 const report={status:200,selector:true,button:true,namePrefilled:true,realSector:true,pendingReview:true,selected:true,persistedAfterReload:true,commercialNumberVisible:true,zeroOperationalRows:counts};
 await fs.writeFile('tmp/catalog-public/quick-product-report.json',JSON.stringify(report,null,2));console.log(report);
}finally{
 if(browser)await browser.close();
 if(cp){const linked=(await pool.query('SELECT operational_product_id FROM commercial_products WHERE id=$1',[cp.commercial_product_id])).rows[0]?.operational_product_id;await pool.query('DELETE FROM commercial_products WHERE id=$1',[cp.commercial_product_id]);if(linked)await pool.query('DELETE FROM products WHERE id=$1 AND creation_origin=$2',[linked,'commercial']);}
 await pool.end();
}
