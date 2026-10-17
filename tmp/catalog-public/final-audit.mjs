import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pool} from '../../backend/src/database/pool.js';
try {
 const before=JSON.parse(await fs.readFile('tmp/catalog-public/codes-before.json','utf8'));
 const after=(await pool.query('SELECT id,commercial_code,commercial_number FROM commercial_products ORDER BY created_at,id')).rows;
 assert.ok(after.length>=before.length);
 const firstSnapshotTotal=before.length;
 for(const row of after.filter(r=>!before.some(b=>b.id===r.id))){
  const audit=(await pool.query("SELECT previous_value FROM audit_logs WHERE entity_id=$1 AND previous_value IS NOT NULL AND NOT(previous_value ? 'commercial_number') ORDER BY created_at LIMIT 1",[row.id])).rows[0];
  assert.ok(audit,'Additional product needs a pre-migration audit snapshot');
  before.push({id:row.id,commercial_code:audit.previous_value.commercial_code});
 }
 const occupied=new Set(before.filter(r=>/^[1-9][0-9]*$/.test(r.commercial_code)).map(r=>Number(r.commercial_code)));
 const assigned=[];
 for(const old of before){const now=after.find(r=>r.id===old.id);assert.ok(now);if(old.commercial_code)assert.equal(now.commercial_code,old.commercial_code);
  if(/^[1-9][0-9]*$/.test(old.commercial_code)){assert.equal(Number(now.commercial_number),Number(old.commercial_code));}
  else{let n=1;while(occupied.has(n))n++;assert.equal(Number(now.commercial_number),n);occupied.add(n);assigned.push({id:old.id,old:old.commercial_code,number:n});}}
 const nums=after.map(r=>Number(r.commercial_number));assert.equal(new Set(nums).size,after.length);assert.ok(nums.every(n=>Number.isSafeInteger(n)&&n>0));
 const codes={firstSnapshotTotal,total:after.length,previousMissing:before.filter(r=>!r.commercial_code).length,previousNumeric:before.filter(r=>/^[1-9][0-9]*$/.test(r.commercial_code)).length,previousAlphanumeric:before.filter(r=>r.commercial_code&&!/^[1-9][0-9]*$/.test(r.commercial_code)).length,newNumbers:assigned.length,missing:0,duplicates:0,min:Math.min(...nums),max:Math.max(...nums),allPreviousReferencesPreserved:true,smallestFreeVerified:true,assigned};
 const smoke=[];for(const [url,method] of [['http://localhost:3333/api/health','GET'],['http://localhost:4173','HEAD'],['https://os.torneadorauniversal.com.br/api/health','GET']]){const r=await fetch(url,{method,signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);smoke.push({url,status:r.status});}
 await fs.writeFile('tmp/catalog-public/final-audit.json',JSON.stringify({codes,smoke},null,2));console.log(JSON.stringify({codes:{...codes,assigned:undefined},smoke},null,2));
}finally{await pool.end();}
