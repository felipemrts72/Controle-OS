import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import {chromium} from 'file:///C:/Users/Win%2010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {pool} from '../../backend/src/database/pool.js';
import {buildAuthUser} from '../../backend/src/services/permissionService.js';
const host='https://os.torneadorauniversal.com.br'; const cp='0592a871-cb8d-4e45-88c2-f3625dac2a5f';
let browser; let baseline; let token; const traffic=[];
try {
const row=(await pool.query("SELECT u.*,r.slug role_slug FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.is_active AND u.approval_status='approved' LIMIT 1")).rows[0];
const user=await buildAuthUser(row);token=jwt.sign({id:user.id},process.env.JWT_SECRET||'dev-secret',{expiresIn:'10m'});
baseline=await(await fetch(`${host}/api/commercial/catalog/products/${cp}`,{headers:{Authorization:`Bearer ${token}`}})).json();
const v=baseline.versions.find(v=>v.id===baseline.active_version_id); if(v.is_used)throw Error('Used');
await fs.writeFile('tmp/catalog-public/jackpot-before-browser.json',JSON.stringify(baseline,null,2));
browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'});
await page.addInitScript(({token,user})=>{localStorage.setItem('token',token);localStorage.setItem('user',JSON.stringify(user))},{token,user});
page.on('request',req=>{if(['PUT','POST'].includes(req.method()))traffic.push({method:req.method(),url:req.url(),bytes:Buffer.byteLength(req.postData()||''),contentType:req.headers()['content-type'],payload:req.postData()});});
page.on('response',async r=>{if(['PUT','POST'].includes(r.request().method()))traffic.push({url:r.url(),status:r.status(),body:(await r.text()).slice(0,200)});});
page.on('requestfailed',r=>traffic.push({failed:r.url(),reason:r.failure()}));
await page.goto(`${host}/comercial/catalogo/${cp}`);
await page.getByLabel('01 — Título comercial').fill('Jackpot 75 (H-3.5) - teste controlado');
await page.getByLabel('02 — Subtítulo').fill('Teste de subtítulo');
await page.getByLabel('03 — Apresentação').fill('Teste de apresentação');
await page.getByRole('button',{name:'Adicionar especificação'}).click();
await page.getByLabel('Característica',{exact:true}).first().fill('Largura');await page.getByLabel('Valor',{exact:true}).first().fill('75');
await page.getByRole('button',{name:'Adicionar item incluso'}).click();await page.getByLabel('Descrição do item').first().fill('Jackpot 75 cm');
await page.getByLabel('06 — Aplicações').fill('Aplicações de teste controlado');await page.getByLabel('07 — Observações').fill('Observações de teste controlado');
await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
await page.waitForTimeout(1500);
console.log('UI',await page.locator('body').innerText());
await page.screenshot({path:'tmp/catalog-public/save-before.png',fullPage:true});
await page.reload();await page.getByLabel('01 — Título comercial').waitFor();console.log('Reload',await page.getByLabel('01 — Título comercial').inputValue());
console.log(JSON.stringify(traffic,null,2));
}finally {
if(baseline&&token){const v=baseline.versions.find(v=>v.id===baseline.active_version_id);const r=await fetch(`${host}/api/commercial/catalog/versions/${v.id}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(v)});console.log('Restore',r.status);}
if(browser)await browser.close();await pool.end();
}

