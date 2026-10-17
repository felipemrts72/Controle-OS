import jwt from 'jsonwebtoken';
import {pool} from '../backend/src/database/pool.js';
import {buildAuthUser} from '../backend/src/services/permissionService.js';
const {chromium}=await import('file:///C:/Users/Win%2010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const admin=(await pool.query("SELECT u.*, r.slug AS role_slug FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username='admin' LIMIT 1")).rows[0];
const user=await buildAuthUser(admin); const token=jwt.sign({id:user.id},process.env.JWT_SECRET||'dev-secret',{expiresIn:'15m'});
const old=(await pool.query("SELECT al.id FROM advance_list_items ali JOIN advance_lists al ON al.id=ali.list_id JOIN advance_cycles ac ON ac.id=al.cycle_id WHERE ali.entry_type='individual' AND ali.status='active' AND ac.status='closed' AND ali.created_at<'2026-10-16' ORDER BY ali.created_at DESC LIMIT 1")).rows[0];
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
try { const context=await browser.newContext({viewport:{width:390,height:740},ignoreHTTPSErrors:true}); await context.addInitScript(({token,user})=>{localStorage.setItem('token',token);localStorage.setItem('user',JSON.stringify(user));},{token,user}); const page=await context.newPage(); await page.goto(`http://localhost:4173/vales/${old.id}`, {waitUntil:'commit',timeout:60000}); await page.getByText('Ciclo fechado: alteração indisponível').waitFor({timeout:15000}); console.log('Vale antigo identificado; motivo do bloqueio visível; sem edição'); await context.close(); } finally {await browser.close(); await pool.end();}

