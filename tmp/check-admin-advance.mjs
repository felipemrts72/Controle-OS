import {pool} from '../backend/src/database/pool.js';
const q=await pool.query("SELECT r.slug, p.code FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.slug='admin' AND p.code IN ('advances.edit','advances.delete') ORDER BY p.code"); console.log(q.rows); await pool.end();
