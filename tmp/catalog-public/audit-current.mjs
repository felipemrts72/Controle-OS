import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from '../../backend/src/database/pool.js';
const cp='0592a871-cb8d-4e45-88c2-f3625dac2a5f';
try {
 const codes=(await pool.query('SELECT id,commercial_code FROM commercial_products ORDER BY created_at,id')).rows;
 await fs.writeFile('tmp/catalog-public/codes-before.json',JSON.stringify(codes,null,2));
 console.log('CODES',JSON.stringify({total:codes.length,missing:codes.filter(r=>!r.commercial_code).length,existing:codes.filter(r=>r.commercial_code)}));
 console.log('SCHEMA',JSON.stringify((await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename='commercial_products'")).rows));
 const admin=(await pool.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.is_active AND u.approval_status='approved' LIMIT 1")).rows[0];
 const token=jwt.sign({id:admin.id},process.env.JWT_SECRET||'dev-secret',{expiresIn:'10m'});
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 for(const host of ['http://localhost:3333','http://localhost:4173','https://os.torneadorauniversal.com.br']) {
  const get=await fetch(`${host}/api/commercial/catalog/products/${cp}`,{headers,signal:AbortSignal.timeout(20000)});
  if(!get.ok)throw Error(`${host} GET ${get.status}`);
  const c=await get.json();const v=c.versions.find(v=>v.id===c.active_version_id); if(v.is_used)throw Error('Used');
  console.log('VERSION',JSON.stringify({host,id:v.id,number:v.version_number,used:v.is_used,images:v.images.map(i=>({id:i.id,bytes:i.size_bytes})),spec:v.specifications,items:v.included_items}));
  const base={name:c.commercial_name,commercial_code:c.commercial_code,is_active:c.is_active,operational_product_id:c.operational_product_id,reference_price:c.reference_price,commercial_description:c.commercial_description,sop_discount_type:c.sop_discount_type,sop_discount_value:c.sop_discount_value};
  for(const [route,payload] of [[`products/${cp}`,base],[`versions/${v.id}`,v]]) {
   const start=Date.now();const r=await fetch(`${host}/api/commercial/catalog/${route}`,{method:'PUT',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
   console.log('PUT',JSON.stringify({host,route,status:r.status,ms:Date.now()-start,bytes:Buffer.byteLength(JSON.stringify(payload)),response:(await r.text()).slice(0,100),ray:r.headers.get('cf-ray')}));
  }
  if(!host.endsWith('3333')){const html=await(await fetch(host)).text();const asset=html.match(/src="([^\"]+\.js)"/)[1];const body=Buffer.from(await(await fetch(host+asset)).arrayBuffer());console.log('BUILD',JSON.stringify({host,asset,sha256:crypto.createHash('sha256').update(body).digest('hex')}));}
 }
}finally{await pool.end();}
