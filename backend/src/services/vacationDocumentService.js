import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = path.resolve(process.env.VACATION_DOCUMENT_DIR || path.join(projectRoot, 'uploads', 'vacations'));
if (process.env.NODE_ENV === 'production' && (!process.env.VACATION_DOCUMENT_DIR || !path.isAbsolute(process.env.VACATION_DOCUMENT_DIR) || !path.relative(projectRoot, root).startsWith('..'))) {
  throw new Error('VACATION_DOCUMENT_DIR deve apontar para um diretório privado, absoluto e persistente fora do código em produção.');
}
const maxBytes = 10 * 1024 * 1024;
const maxDocuments = 20;
const types = new Set(['signed_receipt', 'notice', 'bonus_request', 'payment_proof', 'other']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value) => { if (!uuid.test(String(value))) throw httpError(400, 'Identificador inválido.'); return value; };

export function verifyVacationFile(buffer, mime, name) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError(400, 'Arquivo obrigatório.');
  if (buffer.length > maxBytes) throw httpError(413, 'Arquivo acima de 10 MB.');
  const ext = path.extname(String(name || '')).toLowerCase();
  const expected = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext];
  if (!expected || expected !== mime) throw httpError(400, 'Extensão e MIME incompatíveis.');
  const signature = mime === 'application/pdf' ? buffer.subarray(0, 5).toString() === '%PDF-' && buffer.includes(Buffer.from('%%EOF'))
    : mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  if (!signature) throw httpError(400, 'Assinatura do arquivo inválida.');
  return { mime, originalName: path.basename(String(name)).slice(0, 180) };
}

async function leave(client, employeeId, periodId, leaveId) {
  const row = (await client.query('SELECT id,employee_id,period_id FROM vacation_leaves WHERE id=$1 AND employee_id=$2 AND period_id=$3', [validId(leaveId), validId(employeeId), validId(periodId)])).rows[0];
  if (!row) throw httpError(404, 'Lançamento não encontrado neste período.');
  return row;
}
const publicColumns = 'id,employee_id,period_id,leave_id,document_type,original_name,mime_type,size_bytes,sha256,description,uploaded_by,created_at';
const filePath = (storedName) => path.join(root, `${validId(storedName)}.bin`);
async function audit(client, row, action, actor) {
  await client.query('INSERT INTO vacation_audit(employee_id,period_id,entity_type,entity_id,action,after_data,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [row.employee_id,row.period_id,'document',row.id,action,JSON.stringify({ leave_id:row.leave_id,document_type:row.document_type,sha256:row.sha256 }),actor]);
}

export async function listVacationDocuments(employeeId, periodId, leaveId) {
  return transaction(async (client) => {
    await leave(client, employeeId, periodId, leaveId);
    return (await client.query(`SELECT ${publicColumns} FROM vacation_documents WHERE employee_id=$1 AND period_id=$2 AND leave_id=$3 AND deleted_at IS NULL ORDER BY created_at,id`, [employeeId,periodId,leaveId])).rows;
  });
}

export async function uploadVacationDocument(employeeId, periodId, leaveId, metadata, buffer, actor) {
  const file = verifyVacationFile(buffer, metadata.mime, metadata.originalName);
  if (!types.has(metadata.documentType)) throw httpError(400, 'Tipo documental inválido.');
  const description = String(metadata.description || '').trim().slice(0, 500) || null;
  const id = randomUUID(); const storedName = randomUUID(); const target = filePath(storedName);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  try {
    return await transaction(async (client) => {
      await leave(client, employeeId, periodId, leaveId);
      await client.query('SELECT id FROM vacation_leaves WHERE id=$1 FOR UPDATE', [leaveId]);
      const count = (await client.query('SELECT count(*)::int AS total FROM vacation_documents WHERE leave_id=$1 AND deleted_at IS NULL', [leaveId])).rows[0].total;
      if (count >= maxDocuments) throw httpError(409, 'Limite de 20 documentos por lançamento.');
      await fs.writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
      const hash = createHash('sha256').update(buffer).digest('hex');
      const row = (await client.query(`INSERT INTO vacation_documents(id,employee_id,period_id,leave_id,document_type,original_name,mime_type,size_bytes,sha256,stored_name,description,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${publicColumns}`, [id,employeeId,periodId,leaveId,metadata.documentType,file.originalName,file.mime,buffer.length,hash,storedName,description,actor])).rows[0];
      await audit(client,row,'document_upload',actor);
      return row;
    });
  } catch (error) { await fs.rm(target,{ force:true }); throw error; }
}

export async function readVacationDocument(employeeId, periodId, leaveId, documentId, actor, action = 'document_download') {
  return transaction(async (client) => {
    await leave(client,employeeId,periodId,leaveId);
    const row = (await client.query(`SELECT ${publicColumns},stored_name FROM vacation_documents WHERE id=$1 AND employee_id=$2 AND period_id=$3 AND leave_id=$4 AND deleted_at IS NULL`, [validId(documentId),employeeId,periodId,leaveId])).rows[0];
    if (!row) throw httpError(404,'Documento não encontrado.');
    let buffer;
    try { buffer = await fs.readFile(filePath(row.stored_name)); } catch (error) { if (error.code === 'ENOENT') throw httpError(404,'Arquivo não encontrado no armazenamento.'); throw error; }
    if (createHash('sha256').update(buffer).digest('hex') !== row.sha256) throw httpError(409,'Integridade do arquivo comprometida.');
    await audit(client,row,action,actor);
    delete row.stored_name;
    return { metadata:row, buffer };
  });
}

export async function archiveVacationDocument(employeeId,periodId,leaveId,documentId,actor) {
  return transaction(async (client) => {
    await leave(client,employeeId,periodId,leaveId);
    const row = (await client.query(`UPDATE vacation_documents SET deleted_at=NOW(),deleted_by=$5 WHERE id=$1 AND employee_id=$2 AND period_id=$3 AND leave_id=$4 AND deleted_at IS NULL RETURNING ${publicColumns}`, [validId(documentId),employeeId,periodId,leaveId,actor])).rows[0];
    if (!row) throw httpError(404,'Documento não encontrado.');
    await audit(client,row,'document_archive',actor);
    return row;
  });
}

function crc32(buffer) {
  let crc = -1; for (const byte of buffer) { crc ^= byte; for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0;
}
export function makeZip(entries) {
  const chunks=[]; const central=[]; let offset=0;
  for (const entry of entries) {
    const name=Buffer.from(entry.name,'utf8'); const body=entry.buffer; const crc=crc32(body);
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt32LE(crc,14); local.writeUInt32LE(body.length,18); local.writeUInt32LE(body.length,22); local.writeUInt16LE(name.length,26);
    chunks.push(local,name,body);
    const dir=Buffer.alloc(46); dir.writeUInt32LE(0x02014b50,0); dir.writeUInt16LE(20,4); dir.writeUInt16LE(20,6); dir.writeUInt16LE(0x800,8); dir.writeUInt32LE(crc,16); dir.writeUInt32LE(body.length,20); dir.writeUInt32LE(body.length,24); dir.writeUInt16LE(name.length,28); dir.writeUInt32LE(offset,42); central.push(dir,name);
    offset += local.length+name.length+body.length;
  }
  const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(central.reduce((sum,b)=>sum+b.length,0),12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...central,end]);
}

export async function zipVacationPeriod(employeeId,periodId,actor) {
  return transaction(async (client) => {
    const period=(await client.query('SELECT id FROM vacation_periods WHERE id=$1 AND employee_id=$2',[validId(periodId),validId(employeeId)])).rows[0];
    if (!period) throw httpError(404,'Período não encontrado.');
    const docs=(await client.query(`SELECT ${publicColumns},stored_name FROM vacation_documents WHERE employee_id=$1 AND period_id=$2 AND deleted_at IS NULL ORDER BY created_at,id`,[employeeId,periodId])).rows;
    if (docs.length>100 || docs.reduce((sum,row)=>sum+row.size_bytes,0)>100*1024*1024) throw httpError(413,'Período excede o limite de exportação.');
    const entries=[];
    for (const row of docs) {
      let buffer; try { buffer=await fs.readFile(filePath(row.stored_name)); } catch(error) { if (error.code==='ENOENT') throw httpError(404,'Arquivo não encontrado no armazenamento.'); throw error; }
      if (createHash('sha256').update(buffer).digest('hex')!==row.sha256) throw httpError(409,'Integridade do arquivo comprometida.');
      const safeName=path.basename(row.original_name).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
      entries.push({name:`${row.leave_id}/${row.id}-${safeName}`,buffer});
    }
    await client.query('INSERT INTO vacation_audit(employee_id,period_id,entity_type,entity_id,action,after_data,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[employeeId,periodId,'period',periodId,'document_zip_download',JSON.stringify({ count:docs.length }),actor]);
    return makeZip(entries);
  });
}
