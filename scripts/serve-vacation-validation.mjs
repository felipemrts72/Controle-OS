import fs from 'node:fs';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

const env = dotenv.parse(fs.readFileSync('.env'));
const source = new URL(env.DATABASE_URL);
const testName = process.env.VACATION_TEST_DB;
if (!/^controle_os_ferias_validacao_[0-9a-f]{8}$/.test(testName || '')
  || decodeURIComponent(source.pathname.slice(1)) === testName) throw new Error('Banco de validação inválido.');
source.pathname = `/${testName}`;
process.env.DATABASE_URL = source.toString();
process.env.JWT_SECRET = env.JWT_SECRET;
const { app } = await import('../backend/src/app.js');
const { query } = await import('../backend/src/database/pool.js');
const { buildAuthUser } = await import('../backend/src/services/permissionService.js');
const { listVacationEmployees } = await import('../backend/src/services/vacationService.js');
const outer = express();
outer.get('/__qa/login', async (_req, res, next) => {
  try {
    const result = await query("SELECT u.id, u.name, u.username, u.role, u.role_id, r.slug AS role_slug, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.username LIKE 'qa_ferias_admin_%' ORDER BY u.created_at DESC, u.id DESC LIMIT 1");
    const row = result.rows[0];
    if (!row) return res.status(404).end();
    const user = await buildAuthUser(row);
    const token = jwt.sign({ id: row.id }, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.setHeader('Cache-Control', 'no-store');
    return res.type('html').send(`<!doctype html><meta charset="utf-8"><script>localStorage.setItem('token', ${JSON.stringify(token)});localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});location.replace('/ferias');</script>`);
  } catch (error) { return next(error); }
});
// The restored database contains confidential employees. This temporary server
// limits the initial vacation list to synthetic QA employees before it reaches the API.
outer.get('/api/vacations', async (_req, res, next) => {
  try {
    const token = /^Bearer (.+)$/i.exec(_req.headers.authorization || '')?.[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET);
    res.json(await listVacationEmployees('QA Férias'));
  }
  catch (error) { next(error); }
});
outer.use(app);
outer.use(express.static('dist'));
outer.get('*', (_req, res) => res.sendFile('index.html', { root: 'dist' }));
const port = Number(process.env.VACATION_TEST_PORT || 4817);
outer.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ ui: `http://127.0.0.1:${port}/ferias`, database: testName, synthetic_filter: true })));
