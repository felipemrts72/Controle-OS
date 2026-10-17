import jwt from 'jsonwebtoken';
import {pool} from '../backend/src/database/pool.js';
const user=(await pool.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug<>'admin' AND u.is_active AND u.approval_status='approved' AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=u.role_id AND p.code IN ('advances.edit','advances.delete')) LIMIT 1")).rows[0];
const item=(await pool.query("SELECT ali.id,ali.list_id FROM advance_list_items ali WHERE ali.entry_type='individual' AND ali.status='active' LIMIT 1")).rows[0];
if(!user||!item) throw new Error('Fixture RBAC indisponível');
const token=jwt.sign({id:user.id},process.env.JWT_SECRET||'dev-secret',{expiresIn:'5m'});
for(const method of ['PUT','DELETE']) {const r=await fetch(`http://localhost:3333/api/advances/lists/${item.list_id}/individual/${item.id}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({row_version:'0'})}); console.log(method,r.status); if(r.status!==403) process.exitCode=1;}
await pool.end();
