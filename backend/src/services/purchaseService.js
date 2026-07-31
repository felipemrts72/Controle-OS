import { query, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { hasPermission } from './permissionService.js';

const REQUEST_STATUSES = new Set(['draft','pending_approval','returned','rejected','approved','quoting','supplier_selected','purchased','partially_received','received','cancelled']);
const PRIORITIES = new Set(['low','normal','high','urgent']);
const PURPOSES = new Set(['consumption','stock_replenishment','maintenance','production','investment','other']);
const digits = (value) => String(value || '').replace(/\D/g, '');
const text = (value) => String(value ?? '').trim() || null;
const number = (value, fallback = 0) => value === '' || value == null ? fallback : Number(value);
const pageParams = (filters = {}) => ({ page: Math.max(1, Number(filters.page) || 1), limit: Math.min(100, Math.max(1, Number(filters.limit) || 20)) });
const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

function validateTaxId(value, personType) {
  const valueDigits = digits(value);
  const length = personType === 'individual' ? 11 : 14;
  if (valueDigits.length !== length || /^(\d)\1+$/.test(valueDigits)) return false;
  const cpfDigit = (base, factor) => {
    let sum = 0;
    for (const char of base) sum += Number(char) * factor--;
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  if (length === 11) return cpfDigit(valueDigits.slice(0, 9), 10) === Number(valueDigits[9]) && cpfDigit(valueDigits.slice(0, 10), 11) === Number(valueDigits[10]);
  const cnpjDigit = (base, weights) => {
    const sum = [...base].reduce((total, char, index) => total + Number(char) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return cnpjDigit(valueDigits.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(valueDigits[12])
    && cnpjDigit(valueDigits.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(valueDigits[13]);
}

function supplierPayload(payload) {
  const personType = payload.person_type;
  if (!['legal', 'individual'].includes(personType)) throw httpError(400, 'Tipo de pessoa inválido.');
  if (!text(payload.legal_name)) throw httpError(400, 'Razão social ou nome é obrigatório.');
  const taxId = digits(payload.tax_id);
  if (!validateTaxId(taxId, personType)) throw httpError(400, personType === 'individual' ? 'CPF inválido.' : 'CNPJ inválido.');
  return {
    person_type: personType, legal_name: text(payload.legal_name), trade_name: text(payload.trade_name), tax_id: taxId,
    state_registration: text(payload.state_registration), phone: digits(payload.phone) || null, whatsapp: digits(payload.whatsapp) || null,
    primary_email: text(payload.primary_email), quote_email: text(payload.quote_email), website: text(payload.website), contact_name: text(payload.contact_name),
    contact_phone: digits(payload.contact_phone) || null, contact_whatsapp: digits(payload.contact_whatsapp) || null, contact_email: text(payload.contact_email),
    zip_code: digits(payload.zip_code) || null, address: text(payload.address), address_number: text(payload.address_number), complement: text(payload.complement),
    neighborhood: text(payload.neighborhood), city: text(payload.city), state: text(payload.state)?.toUpperCase() || null, notes: text(payload.notes),
    average_delivery_days: payload.average_delivery_days === '' || payload.average_delivery_days == null ? null : Number(payload.average_delivery_days),
    default_payment_terms: text(payload.default_payment_terms), group_ids: Array.isArray(payload.group_ids) ? [...new Set(payload.group_ids.filter(Boolean))] : [],
  };
}

async function replaceSupplierGroups(client, supplierId, groupIds) {
  if (groupIds.length) {
    const valid = await client.query('SELECT id FROM material_groups WHERE id = ANY($1::uuid[])', [groupIds]);
    if (valid.rowCount !== groupIds.length) throw httpError(400, 'Um ou mais grupos de materiais são inválidos.');
  }
  await client.query('DELETE FROM supplier_material_groups WHERE supplier_id = $1', [supplierId]);
  if (groupIds.length) await client.query(
    'INSERT INTO supplier_material_groups (supplier_id, material_group_id) SELECT $1, unnest($2::uuid[])', [supplierId, groupIds],
  );
}

export async function listSuppliers(filters = {}) {
  const { page, limit } = pageParams(filters); const offset = (page - 1) * limit;
  const params = []; const where = [];
  if (filters.active !== 'all') { params.push(filters.active === 'false' ? false : true); where.push(`s.is_active = $${params.length}`); }
  if (text(filters.search)) { params.push(`%${text(filters.search)}%`); where.push(`(s.legal_name ILIKE $${params.length} OR s.trade_name ILIKE $${params.length} OR s.tax_id ILIKE $${params.length} OR s.city ILIKE $${params.length} OR s.contact_name ILIKE $${params.length} OR EXISTS (SELECT 1 FROM supplier_material_groups smg JOIN material_groups mg ON mg.id=smg.material_group_id WHERE smg.supplier_id=s.id AND mg.name ILIKE $${params.length}))`); }
  if (filters.group_id) { params.push(filters.group_id); where.push(`EXISTS (SELECT 1 FROM supplier_material_groups smg WHERE smg.supplier_id=s.id AND smg.material_group_id=$${params.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await query(`SELECT COUNT(*)::int total FROM suppliers s ${clause}`, params);
  params.push(limit, offset);
  const rows = await query(`SELECT s.*, COALESCE(json_agg(json_build_object('id',mg.id,'name',mg.name)) FILTER (WHERE mg.id IS NOT NULL),'[]') groups
    FROM suppliers s LEFT JOIN supplier_material_groups smg ON smg.supplier_id=s.id LEFT JOIN material_groups mg ON mg.id=smg.material_group_id
    ${clause} GROUP BY s.id ORDER BY s.is_active DESC, COALESCE(s.trade_name,s.legal_name) LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { data: rows.rows, pagination: { page, limit, total: total.rows[0].total, pages: Math.ceil(total.rows[0].total / limit) } };
}

export async function getSupplier(id) {
  const result = await query(`SELECT s.*, COALESCE(json_agg(json_build_object('id',mg.id,'name',mg.name)) FILTER (WHERE mg.id IS NOT NULL),'[]') groups
    FROM suppliers s LEFT JOIN supplier_material_groups smg ON smg.supplier_id=s.id LEFT JOIN material_groups mg ON mg.id=smg.material_group_id WHERE s.id=$1 GROUP BY s.id`, [id]);
  if (!result.rows[0]) throw httpError(404, 'Fornecedor não encontrado.'); return result.rows[0];
}

export async function createSupplier(payload, user) {
  const data = supplierPayload(payload);
  return transaction(async (client) => {
    let created;
    try {
      const values = Object.entries(data).filter(([key]) => key !== 'group_ids');
      const result = await client.query(`INSERT INTO suppliers (${values.map(([key]) => key).join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, values.map(([, value]) => value));
      created = result.rows[0];
    } catch (error) { if (error.code === '23505') throw httpError(409, 'Já existe fornecedor com este CPF ou CNPJ.'); throw error; }
    await replaceSupplierGroups(client, created.id, data.group_ids);
    await logAudit(client, { entityType: 'supplier', entityId: created.id, action: 'created', newValue: { ...created, group_ids: data.group_ids }, userId: user.id });
    return getSupplierWithClient(client, created.id);
  });
}

async function getSupplierWithClient(client, id) {
  const result = await client.query(`SELECT s.*, COALESCE(json_agg(json_build_object('id',mg.id,'name',mg.name)) FILTER (WHERE mg.id IS NOT NULL),'[]') groups FROM suppliers s LEFT JOIN supplier_material_groups smg ON smg.supplier_id=s.id LEFT JOIN material_groups mg ON mg.id=smg.material_group_id WHERE s.id=$1 GROUP BY s.id`, [id]);
  return result.rows[0];
}

export async function updateSupplier(id, payload, user) {
  const data = supplierPayload(payload);
  return transaction(async (client) => {
    const previous = await getSupplierWithClient(client, id); if (!previous) throw httpError(404, 'Fornecedor não encontrado.');
    const values = Object.entries(data).filter(([key]) => key !== 'group_ids');
    let updated;
    try { updated = (await client.query(`UPDATE suppliers SET ${values.map(([key], i) => `${key}=$${i + 1}`).join(',')}, updated_at=NOW() WHERE id=$${values.length + 1} RETURNING *`, [...values.map(([, value]) => value), id])).rows[0]; }
    catch (error) { if (error.code === '23505') throw httpError(409, 'Já existe fornecedor com este CPF ou CNPJ.'); throw error; }
    await replaceSupplierGroups(client, id, data.group_ids);
    const current = await getSupplierWithClient(client, id);
    await logAudit(client, { entityType: 'supplier', entityId: id, action: 'updated', previousValue: previous, newValue: current, userId: user.id });
    return current;
  });
}

export async function setSupplierActive(id, isActive, user) {
  return transaction(async (client) => {
    const result = await client.query('UPDATE suppliers SET is_active=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [Boolean(isActive), id]);
    if (!result.rows[0]) throw httpError(404, 'Fornecedor não encontrado.');
    await logAudit(client, { entityType: 'supplier', entityId: id, action: isActive ? 'reactivated' : 'deactivated', previousValue: { is_active: !isActive }, newValue: { is_active: Boolean(isActive) }, userId: user.id });
    return result.rows[0];
  });
}

export async function listMaterialGroups(filters = {}) {
  const params = []; const where = [];
  if (filters.active !== 'all') { params.push(filters.active === 'false' ? false : true); where.push(`is_active=$${params.length}`); }
  if (text(filters.search)) { params.push(`%${text(filters.search)}%`); where.push(`name ILIKE $${params.length}`); }
  return (await query(`SELECT * FROM material_groups ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY is_active DESC,name`, params)).rows;
}

export async function createMaterialGroup(payload, user) {
  const name = text(payload.name); if (!name) throw httpError(400, 'Nome é obrigatório.');
  return transaction(async (client) => {
    let row; try { row = (await client.query('INSERT INTO material_groups(name,normalized_name) VALUES($1,$2) RETURNING *', [name, normalizeName(name)])).rows[0]; }
    catch (error) { if (error.code === '23505') throw httpError(409, 'Já existe um grupo com este nome.'); throw error; }
    await logAudit(client, { entityType: 'material_group', entityId: row.id, action: 'created', newValue: row, userId: user.id }); return row;
  });
}

export async function updateMaterialGroup(id, payload, user) {
  const name = text(payload.name); if (!name) throw httpError(400, 'Nome é obrigatório.');
  return transaction(async (client) => {
    const previous = (await client.query('SELECT * FROM material_groups WHERE id=$1', [id])).rows[0]; if (!previous) throw httpError(404, 'Grupo não encontrado.');
    let row; try { row = (await client.query('UPDATE material_groups SET name=$1,normalized_name=$2,updated_at=NOW() WHERE id=$3 RETURNING *', [name, normalizeName(name), id])).rows[0]; }
    catch (error) { if (error.code === '23505') throw httpError(409, 'Já existe um grupo com este nome.'); throw error; }
    await logAudit(client, { entityType: 'material_group', entityId: id, action: 'updated', previousValue: previous, newValue: row, userId: user.id }); return row;
  });
}

export async function setMaterialGroupActive(id, isActive, user) {
  return transaction(async (client) => {
    const row = (await client.query('UPDATE material_groups SET is_active=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [Boolean(isActive), id])).rows[0];
    if (!row) throw httpError(404, 'Grupo não encontrado.');
    await logAudit(client, { entityType: 'material_group', entityId: id, action: isActive ? 'reactivated' : 'deactivated', newValue: row, userId: user.id }); return row;
  });
}

async function nextNumber(client, type, prefix) {
  const year = new Date().getFullYear();
  const result = await client.query(`INSERT INTO purchase_counters(counter_type,counter_year,last_value) VALUES($1,$2,1)
    ON CONFLICT(counter_type,counter_year) DO UPDATE SET last_value=purchase_counters.last_value+1 RETURNING last_value`, [type, year]);
  return `${prefix}-${year}-${String(result.rows[0].last_value).padStart(5, '0')}`;
}

function requestData(payload) {
  if (!text(payload.justification)) throw httpError(400, 'Justificativa é obrigatória.');
  if (!PRIORITIES.has(payload.priority || 'normal')) throw httpError(400, 'Prioridade inválida.');
  if (!PURPOSES.has(payload.purpose)) throw httpError(400, 'Finalidade inválida.');
  if (!Array.isArray(payload.items) || !payload.items.length) throw httpError(400, 'Adicione ao menos um item.');
  const items = payload.items.map((item) => {
    if (!text(item.description) || !text(item.unit) || !(number(item.quantity) > 0)) throw httpError(400, 'Descrição, unidade e quantidade positiva são obrigatórias em todos os itens.');
    return { description: text(item.description), material_group_id: item.material_group_id || null, unit: text(item.unit), quantity: number(item.quantity), technical_specification: text(item.technical_specification), preferred_brand: text(item.preferred_brand), brand_required: Boolean(item.brand_required), reference_code: text(item.reference_code), notes: text(item.notes), estimated_unit_value: item.estimated_unit_value === '' || item.estimated_unit_value == null ? null : number(item.estimated_unit_value), needed_date: item.needed_date || null, specific_purpose: text(item.specific_purpose), allows_equivalent: item.allows_equivalent !== false, product_id: item.product_id || null };
  });
  return { sector_id: payload.sector_id || null, request_date: payload.request_date || new Date().toISOString().slice(0,10), justification: text(payload.justification), notes: text(payload.notes), priority: payload.priority || 'normal', purpose: payload.purpose, needed_date: payload.needed_date || null, items };
}

async function insertRequestItems(client, requestId, items) {
  for (const item of items) {
    const entries = Object.entries(item); await client.query(`INSERT INTO purchase_request_items(request_id,${entries.map(([key]) => key).join(',')}) VALUES($1,${entries.map((_, i) => `$${i + 2}`).join(',')})`, [requestId, ...entries.map(([, value]) => value)]);
  }
}

async function addRequestHistory(client, request, userId, action, previousStatus, newStatus, reason = null) {
  await client.query('INSERT INTO purchase_request_history(request_id,user_id,previous_status,new_status,reason,action) VALUES($1,$2,$3,$4,$5,$6)', [request.id, userId, previousStatus, newStatus, reason, action]);
  await logAudit(client, { entityType: 'purchase_request', entityId: request.id, action, previousValue: { status: previousStatus }, newValue: { status: newStatus, reason }, userId });
}

export async function createPurchaseRequest(payload, user, mode = 'standard') {
  const data = requestData(payload);
  if (mode === 'preapproved' && !hasPermission(user, 'purchases.create_preapproved')) throw httpError(403, 'Sem permissão para solicitação pré-aprovada.');
  const status = mode === 'preapproved' ? 'approved' : 'draft';
  return transaction(async (client) => {
    const requestNumber = await nextNumber(client, 'request', 'SC');
    const row = (await client.query(`INSERT INTO purchase_requests(number,requester_id,sector_id,request_date,justification,notes,priority,purpose,needed_date,status,approver_id,approved_at,is_preapproved)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [requestNumber,user.id,data.sector_id,data.request_date,data.justification,data.notes,data.priority,data.purpose,data.needed_date,status,status==='approved'?user.id:null,status==='approved'?new Date():null,status==='approved'])).rows[0];
    await insertRequestItems(client, row.id, data.items); await addRequestHistory(client, row, user.id, 'created', null, status, mode === 'preapproved' ? 'Criada pré-aprovada' : null); return getPurchaseRequestWithClient(client, row.id, user);
  });
}

export async function listPurchaseRequests(filters = {}, user) {
  const { page, limit } = pageParams(filters); const params=[]; const where=[];
  if (text(filters.status)) { params.push(filters.status); where.push(`pr.status=$${params.length}`); }
  if (text(filters.search)) { params.push(`%${text(filters.search)}%`); where.push(`(pr.number ILIKE $${params.length} OR pr.justification ILIKE $${params.length} OR u.name ILIKE $${params.length})`); }
  if (filters.mine === 'true') { params.push(user.id); where.push(`pr.requester_id=$${params.length}`); }
  if (filters.priority) { params.push(filters.priority); where.push(`pr.priority=$${params.length}`); }
  const clause=where.length?`WHERE ${where.join(' AND ')}`:'';
  const total=(await query(`SELECT COUNT(*)::int total FROM purchase_requests pr JOIN users u ON u.id=pr.requester_id ${clause}`,params)).rows[0].total;
  params.push(limit,(page-1)*limit);
  const result=await query(`SELECT pr.*,u.name requester_name,s.name sector_name,a.name approver_name,COUNT(pri.id)::int item_count,
    ${hasPermission(user,'purchases.view_values') ? 'COALESCE(SUM(pri.quantity*pri.estimated_unit_value),0)' : 'NULL'} estimated_total
    FROM purchase_requests pr JOIN users u ON u.id=pr.requester_id LEFT JOIN users a ON a.id=pr.approver_id LEFT JOIN sectors s ON s.id=pr.sector_id LEFT JOIN purchase_request_items pri ON pri.request_id=pr.id
    ${clause} GROUP BY pr.id,u.name,s.name,a.name ORDER BY (pr.priority='urgent') DESC,pr.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
  return {data:result.rows,pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}

async function getPurchaseRequestWithClient(client, id, user) {
  const result=await client.query(`SELECT pr.*,u.name requester_name,s.name sector_name,a.name approver_name FROM purchase_requests pr JOIN users u ON u.id=pr.requester_id LEFT JOIN users a ON a.id=pr.approver_id LEFT JOIN sectors s ON s.id=pr.sector_id WHERE pr.id=$1`,[id]);
  if(!result.rows[0]) throw httpError(404,'Solicitação não encontrada.'); const row=result.rows[0];
  row.items=(await client.query(`SELECT pri.*,mg.name material_group_name FROM purchase_request_items pri LEFT JOIN material_groups mg ON mg.id=pri.material_group_id WHERE pri.request_id=$1 ORDER BY pri.created_at`,[id])).rows;
  if(!hasPermission(user,'purchases.view_values')) row.items=row.items.map(({estimated_unit_value,...item})=>item);
  row.history=(await client.query(`SELECT h.*,u.name user_name FROM purchase_request_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.request_id=$1 ORDER BY h.created_at`,[id])).rows; return row;
}

export async function getPurchaseRequest(id,user){return transaction((client)=>getPurchaseRequestWithClient(client,id,user));}

export async function updatePurchaseRequest(id,payload,user){
  const data=requestData(payload); return transaction(async(client)=>{
    const current=(await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE',[id])).rows[0]; if(!current) throw httpError(404,'Solicitação não encontrada.');
    if(current.requester_id!==user.id || !hasPermission(user,'purchases.edit_own_request')) throw httpError(403,'Somente o solicitante autorizado pode editar.');
    if(!['draft','returned'].includes(current.status)) throw httpError(409,'Esta solicitação não pode mais ser editada.');
    await client.query(`UPDATE purchase_requests SET sector_id=$1,request_date=$2,justification=$3,notes=$4,priority=$5,purpose=$6,needed_date=$7,updated_at=NOW() WHERE id=$8`,[data.sector_id,data.request_date,data.justification,data.notes,data.priority,data.purpose,data.needed_date,id]);
    await client.query('DELETE FROM purchase_request_items WHERE request_id=$1',[id]); await insertRequestItems(client,id,data.items);
    await logAudit(client,{entityType:'purchase_request',entityId:id,action:'updated',previousValue:current,newValue:data,userId:user.id}); return getPurchaseRequestWithClient(client,id,user);
  });
}

export async function transitionPurchaseRequest(id,action,reason,user){
  const map={submit:{from:['draft','returned'],to:'pending_approval'},approve:{from:['pending_approval'],to:'approved'},return:{from:['pending_approval'],to:'returned'},reject:{from:['pending_approval'],to:'rejected'},cancel:{from:[...REQUEST_STATUSES].filter(s=>!['received','cancelled'].includes(s)),to:'cancelled'}};
  const transition=map[action]; if(!transition) throw httpError(400,'Ação inválida.');
  if(['return','reject','cancel'].includes(action)&&!text(reason)) throw httpError(400,'Motivo é obrigatório.');
  return transaction(async(client)=>{
    const current=(await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE',[id])).rows[0]; if(!current) throw httpError(404,'Solicitação não encontrada.');
    if(!transition.from.includes(current.status)) throw httpError(409,`Transição não permitida a partir de ${current.status}.`);
    if(action==='submit'&&(current.requester_id!==user.id||!hasPermission(user,'purchases.create_request'))) throw httpError(403,'Sem permissão para enviar esta solicitação.');
    if(['approve','return','reject'].includes(action)&&!hasPermission(user,'purchases.approve')) throw httpError(403,'Sem permissão para decidir solicitações.');
    if(action==='cancel'&&!hasPermission(user,'purchases.cancel')) throw httpError(403,'Sem permissão para cancelar.');
    const row=(await client.query(`UPDATE purchase_requests SET status=$1,approver_id=CASE WHEN $2='approve' THEN $3 ELSE approver_id END,approved_at=CASE WHEN $2='approve' THEN NOW() ELSE approved_at END,decision_reason=$4,cancelled_at=CASE WHEN $2='cancel' THEN NOW() ELSE cancelled_at END,cancelled_by=CASE WHEN $2='cancel' THEN $3 ELSE cancelled_by END,updated_at=NOW() WHERE id=$5 RETURNING *`,[transition.to,action,user.id,text(reason),id])).rows[0];
    await addRequestHistory(client,row,user.id,action,current.status,transition.to,text(reason)); return getPurchaseRequestWithClient(client,id,user);
  });
}

export async function createQuoteRequest(payload,user){
  if(!Array.isArray(payload.item_ids)||!payload.item_ids.length||!Array.isArray(payload.supplier_ids)||!payload.supplier_ids.length) throw httpError(400,'Selecione ao menos um item e um fornecedor.');
  return transaction(async(client)=>{
    const request=(await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE',[payload.purchase_request_id])).rows[0];
    if(!request) throw httpError(404,'Solicitação não encontrada.'); if(!['approved','quoting'].includes(request.status)) throw httpError(409,'A solicitação precisa estar aprovada.');
    const validItems=await client.query('SELECT id FROM purchase_request_items WHERE request_id=$1 AND id=ANY($2::uuid[])',[request.id,payload.item_ids]);
    if(validItems.rowCount!==new Set(payload.item_ids).size) throw httpError(400,'Há itens que não pertencem à solicitação.');
    const validSuppliers=await client.query('SELECT id FROM suppliers WHERE is_active=TRUE AND id=ANY($1::uuid[])',[payload.supplier_ids]);
    if(validSuppliers.rowCount!==new Set(payload.supplier_ids).size) throw httpError(400,'Há fornecedores inválidos ou inativos.');
    const quoteNumber=await nextNumber(client,'quote','COT');
    const row=(await client.query(`INSERT INTO purchase_quote_requests(number,purchase_request_id,response_deadline,delivery_address,response_email,response_whatsapp,notes,responsible_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[quoteNumber,request.id,payload.response_deadline||null,text(payload.delivery_address),text(payload.response_email),digits(payload.response_whatsapp)||null,text(payload.notes),user.id])).rows[0];
    await client.query('INSERT INTO purchase_quote_items(quote_request_id,request_item_id) SELECT $1,unnest($2::uuid[])',[row.id,payload.item_ids]);
    await client.query('INSERT INTO purchase_quote_suppliers(quote_request_id,supplier_id) SELECT $1,unnest($2::uuid[])',[row.id,payload.supplier_ids]);
    if(request.status!=='quoting'){await client.query("UPDATE purchase_requests SET status='quoting',updated_at=NOW() WHERE id=$1",[request.id]);await addRequestHistory(client,request,user.id,'quote_created',request.status,'quoting');}
    await logAudit(client,{entityType:'purchase_quote',entityId:row.id,action:'created',newValue:{...row,item_ids:payload.item_ids,supplier_ids:payload.supplier_ids},userId:user.id}); return getQuoteWithClient(client,row.id);
  });
}

export async function suggestSuppliers(requestId){
  return (await query(`SELECT DISTINCT s.id,s.legal_name,s.trade_name,s.city,s.state,
    array_agg(DISTINCT mg.name) FILTER(WHERE mg.name IS NOT NULL) matched_groups
    FROM purchase_request_items pri JOIN supplier_material_groups smg ON smg.material_group_id=pri.material_group_id
    JOIN suppliers s ON s.id=smg.supplier_id AND s.is_active=TRUE JOIN material_groups mg ON mg.id=smg.material_group_id
    WHERE pri.request_id=$1 GROUP BY s.id ORDER BY COALESCE(s.trade_name,s.legal_name)`,[requestId])).rows;
}

export async function listQuoteRequests(filters={}){
  const {page,limit}=pageParams(filters);const params=[];const where=[];
  if(filters.status){params.push(filters.status);where.push(`q.status=$${params.length}`);} if(filters.search){params.push(`%${text(filters.search)}%`);where.push(`(q.number ILIKE $${params.length} OR pr.number ILIKE $${params.length})`);}
  const clause=where.length?`WHERE ${where.join(' AND ')}`:'';const total=(await query(`SELECT COUNT(*)::int total FROM purchase_quote_requests q JOIN purchase_requests pr ON pr.id=q.purchase_request_id ${clause}`,params)).rows[0].total;
  params.push(limit,(page-1)*limit);const rows=await query(`SELECT q.*,pr.number request_number,u.name responsible_name,COUNT(DISTINCT qs.supplier_id)::int supplier_count,COUNT(DISTINCT sp.id)::int response_count FROM purchase_quote_requests q JOIN purchase_requests pr ON pr.id=q.purchase_request_id JOIN users u ON u.id=q.responsible_id LEFT JOIN purchase_quote_suppliers qs ON qs.quote_request_id=q.id LEFT JOIN supplier_proposals sp ON sp.quote_request_id=q.id ${clause} GROUP BY q.id,pr.number,u.name ORDER BY q.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
  return {data:rows.rows,pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}

async function getQuoteWithClient(client,id){
  const result=await client.query(`SELECT q.*,pr.number request_number,pr.justification,pr.priority,u.name responsible_name FROM purchase_quote_requests q JOIN purchase_requests pr ON pr.id=q.purchase_request_id JOIN users u ON u.id=q.responsible_id WHERE q.id=$1`,[id]);if(!result.rows[0])throw httpError(404,'Cotação não encontrada.');const row=result.rows[0];
  row.items=(await client.query(`SELECT pri.* ,mg.name material_group_name FROM purchase_quote_items qi JOIN purchase_request_items pri ON pri.id=qi.request_item_id LEFT JOIN material_groups mg ON mg.id=pri.material_group_id WHERE qi.quote_request_id=$1 ORDER BY pri.created_at`,[id])).rows;
  row.suppliers=(await client.query(`SELECT s.* FROM purchase_quote_suppliers qs JOIN suppliers s ON s.id=qs.supplier_id WHERE qs.quote_request_id=$1 ORDER BY COALESCE(s.trade_name,s.legal_name)`,[id])).rows;
  row.dispatches=(await client.query(`SELECT d.*,s.legal_name supplier_name,u.name sent_by_name FROM purchase_quote_dispatches d LEFT JOIN suppliers s ON s.id=d.supplier_id JOIN users u ON u.id=d.sent_by WHERE d.quote_request_id=$1 ORDER BY d.sent_at DESC`,[id])).rows;
  row.proposals=(await client.query(`SELECT sp.*,s.legal_name supplier_name,s.trade_name supplier_trade_name,COALESCE(json_agg(json_build_object('id',spi.id,'request_item_id',spi.request_item_id,'unit_value',spi.unit_value,'offered_brand',spi.offered_brand,'is_equivalent',spi.is_equivalent,'quoted_quantity',spi.quoted_quantity,'notes',spi.notes)) FILTER(WHERE spi.id IS NOT NULL),'[]') items FROM supplier_proposals sp JOIN suppliers s ON s.id=sp.supplier_id LEFT JOIN supplier_proposal_items spi ON spi.proposal_id=sp.id WHERE sp.quote_request_id=$1 GROUP BY sp.id,s.legal_name,s.trade_name ORDER BY sp.created_at`,[id])).rows;
  row.selections=(await client.query(`SELECT sel.*,s.legal_name supplier_name FROM purchase_quote_selections sel JOIN suppliers s ON s.id=sel.supplier_id WHERE sel.quote_request_id=$1`,[id])).rows;return row;
}
export async function getQuoteRequest(id,user=null){const quote=await transaction(client=>getQuoteWithClient(client,id));if(user&&!hasPermission(user,'purchases.view_values'))quote.proposals=quote.proposals.map(({freight,additional_taxes,total_value,...proposal})=>({...proposal,items:proposal.items.map(({unit_value,...item})=>item)}));return quote;}

export async function registerQuoteDispatch(id,payload,user){
  if(!['email','whatsapp','other'].includes(payload.channel))throw httpError(400,'Canal inválido.');return transaction(async(client)=>{
    const quote=(await client.query('SELECT * FROM purchase_quote_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!quote)throw httpError(404,'Cotação não encontrada.');
    if(payload.supplier_id){const linked=await client.query('SELECT 1 FROM purchase_quote_suppliers WHERE quote_request_id=$1 AND supplier_id=$2',[id,payload.supplier_id]);if(!linked.rowCount)throw httpError(400,'Fornecedor não pertence à cotação.');}
    const row=(await client.query('INSERT INTO purchase_quote_dispatches(quote_request_id,supplier_id,channel,destination,notes,sent_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,payload.supplier_id||null,payload.channel,text(payload.destination),text(payload.notes),user.id])).rows[0];
    await client.query("UPDATE purchase_quote_requests SET status='sent',updated_at=NOW() WHERE id=$1 AND status='draft'",[id]);await logAudit(client,{entityType:'purchase_quote',entityId:id,action:'manual_send_registered',newValue:row,userId:user.id});return row;
  });
}

export async function registerProposal(id,payload,user){
  if(!payload.supplier_id||!payload.proposal_date)throw httpError(400,'Fornecedor e data da proposta são obrigatórios.');const items=Array.isArray(payload.items)?payload.items:[];
  return transaction(async(client)=>{
    const quote=(await client.query('SELECT * FROM purchase_quote_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!quote)throw httpError(404,'Cotação não encontrada.');
    const linked=await client.query('SELECT 1 FROM purchase_quote_suppliers WHERE quote_request_id=$1 AND supplier_id=$2',[id,payload.supplier_id]);if(!linked.rowCount)throw httpError(400,'Fornecedor não pertence à cotação.');
    const validItemIds=(await client.query('SELECT request_item_id id FROM purchase_quote_items WHERE quote_request_id=$1',[id])).rows.map(r=>r.id);if(items.some(item=>!validItemIds.includes(item.request_item_id)))throw httpError(400,'Item inválido na proposta.');
    const itemTotal=items.reduce((sum,item)=>sum+(number(item.unit_value)*number(item.quoted_quantity)),0);const total=itemTotal+number(payload.freight)+number(payload.additional_taxes);
    const proposal=(await client.query(`INSERT INTO supplier_proposals(quote_request_id,supplier_id,proposal_date,valid_until,payment_terms,delivery_days,freight,additional_taxes,notes,total_value,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(quote_request_id,supplier_id) DO UPDATE SET proposal_date=EXCLUDED.proposal_date,valid_until=EXCLUDED.valid_until,payment_terms=EXCLUDED.payment_terms,delivery_days=EXCLUDED.delivery_days,freight=EXCLUDED.freight,additional_taxes=EXCLUDED.additional_taxes,notes=EXCLUDED.notes,total_value=EXCLUDED.total_value,updated_at=NOW() RETURNING *`,[id,payload.supplier_id,payload.proposal_date,payload.valid_until||null,text(payload.payment_terms),payload.delivery_days===''?null:number(payload.delivery_days),number(payload.freight),number(payload.additional_taxes),text(payload.notes),total,user.id])).rows[0];
    await client.query('DELETE FROM supplier_proposal_items WHERE proposal_id=$1',[proposal.id]);for(const item of items){if(item.unit_value===''||item.unit_value==null)continue;await client.query('INSERT INTO supplier_proposal_items(proposal_id,request_item_id,unit_value,offered_brand,is_equivalent,quoted_quantity,notes) VALUES($1,$2,$3,$4,$5,$6,$7)',[proposal.id,item.request_item_id,number(item.unit_value),text(item.offered_brand),Boolean(item.is_equivalent),item.quoted_quantity===''?null:number(item.quoted_quantity),text(item.notes)]);}
    await client.query("UPDATE purchase_quote_requests SET status='responses_received',updated_at=NOW() WHERE id=$1",[id]);await logAudit(client,{entityType:'purchase_quote',entityId:id,action:'proposal_registered',newValue:{proposal_id:proposal.id,supplier_id:payload.supplier_id,total},userId:user.id});return getQuoteWithClient(client,id);
  });
}

export async function selectQuoteSuppliers(id,payload,user){
  const selections=Array.isArray(payload.selections)?payload.selections:[];if(!selections.length)throw httpError(400,'Selecione um fornecedor para cada item desejado.');
  return transaction(async(client)=>{
    const quote=(await client.query('SELECT * FROM purchase_quote_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!quote)throw httpError(404,'Cotação não encontrada.');
    const quoteData=await getQuoteWithClient(client,id);const validItems=new Set(quoteData.items.map(item=>item.id));if(selections.some(sel=>!validItems.has(sel.request_item_id)))throw httpError(400,'Seleção contém item inválido.');
    for(const selection of selections){const proposal=quoteData.proposals.find(p=>p.supplier_id===selection.supplier_id);const proposalItem=proposal?.items.find(item=>item.request_item_id===selection.request_item_id&&item.unit_value!=null);if(!proposalItem)throw httpError(400,'O fornecedor escolhido não cotou um dos itens.');
      const offers=quoteData.proposals.flatMap(p=>p.items.filter(item=>item.request_item_id===selection.request_item_id&&item.unit_value!=null).map(item=>({supplier_id:p.supplier_id,value:Number(item.unit_value)})));const min=Math.min(...offers.map(o=>o.value));if(Number(proposalItem.unit_value)>min&&!text(selection.justification))throw httpError(400,'Justificativa obrigatória quando a escolha não é o menor preço.');
    }
    await client.query('DELETE FROM purchase_quote_selections WHERE quote_request_id=$1',[id]);for(const selection of selections){const proposal=quoteData.proposals.find(p=>p.supplier_id===selection.supplier_id);const proposalItem=proposal.items.find(item=>item.request_item_id===selection.request_item_id);await client.query('INSERT INTO purchase_quote_selections(quote_request_id,request_item_id,supplier_id,proposal_item_id,justification,selected_by) VALUES($1,$2,$3,$4,$5,$6)',[id,selection.request_item_id,selection.supplier_id,proposalItem.id,text(selection.justification),user.id]);}
    await client.query("UPDATE purchase_quote_requests SET status='completed',updated_at=NOW() WHERE id=$1",[id]);const request=(await client.query("UPDATE purchase_requests SET status='supplier_selected',updated_at=NOW() WHERE id=$1 RETURNING *",[quote.purchase_request_id])).rows[0];await addRequestHistory(client,request,user.id,'supplier_selected','quoting','supplier_selected');
    await logAudit(client,{entityType:'purchase_quote',entityId:id,action:'suppliers_selected',newValue:{selections},userId:user.id});return createPurchasesFromSelections(client,id,user);
  });
}

async function createPurchasesFromSelections(client,quoteId,user){
  const quote=await getQuoteWithClient(client,quoteId);const grouped=new Map();for(const selection of quote.selections){if(!grouped.has(selection.supplier_id))grouped.set(selection.supplier_id,[]);grouped.get(selection.supplier_id).push(selection);}
  const purchases=[];for(const [supplierId,selections] of grouped){const proposal=quote.proposals.find(p=>p.supplier_id===supplierId);const purchaseNumber=await nextNumber(client,'purchase','PC');const selectedItems=selections.map(sel=>{const requestItem=quote.items.find(i=>i.id===sel.request_item_id);const proposalItem=proposal.items.find(i=>i.id===sel.proposal_item_id);return{requestItem,proposalItem};});const subtotal=selectedItems.reduce((sum,x)=>sum+Number(x.requestItem.quantity)*Number(x.proposalItem.unit_value),0);const freight=grouped.size===1?Number(proposal.freight):0;const taxes=grouped.size===1?Number(proposal.additional_taxes):0;
    const purchase=(await client.query(`INSERT INTO purchases(number,purchase_request_id,quote_request_id,supplier_id,buyer_id,freight,taxes,total,payment_terms,expected_delivery_date,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10::int IS NULL THEN NULL ELSE CURRENT_DATE+$10::int END,'preparing') RETURNING *`,[purchaseNumber,quote.purchase_request_id,quoteId,supplierId,user.id,freight,taxes,subtotal+freight+taxes,proposal.payment_terms,proposal.delivery_days])).rows[0];
    for(const {requestItem,proposalItem} of selectedItems){await client.query('INSERT INTO purchase_items(purchase_id,request_item_id,description,unit,quantity,unit_value,total) VALUES($1,$2,$3,$4,$5,$6,$7)',[purchase.id,requestItem.id,requestItem.description,requestItem.unit,requestItem.quantity,proposalItem.unit_value,Number(requestItem.quantity)*Number(proposalItem.unit_value)]);}await logAudit(client,{entityType:'purchase',entityId:purchase.id,action:'created_from_quote',newValue:purchase,userId:user.id});purchases.push(purchase);}
  await client.query("UPDATE purchase_requests SET status='purchased',updated_at=NOW() WHERE id=$1",[quote.purchase_request_id]);return purchases;
}

export async function createDirectPurchase(payload,user){
  if(!text(payload.justification))throw httpError(400,'Justificativa da compra direta é obrigatória.');if(!payload.supplier_id||!Array.isArray(payload.items)||!payload.items.length)throw httpError(400,'Fornecedor e itens são obrigatórios.');
  return transaction(async(client)=>{const supplier=(await client.query('SELECT * FROM suppliers WHERE id=$1 AND is_active=TRUE',[payload.supplier_id])).rows[0];if(!supplier)throw httpError(400,'Fornecedor inválido ou inativo.');const purchaseNumber=await nextNumber(client,'purchase','PC');const subtotal=payload.items.reduce((sum,item)=>sum+number(item.quantity)*number(item.unit_value)-number(item.discount),0);const total=subtotal-number(payload.discount)+number(payload.freight)+number(payload.taxes);if(total<0)throw httpError(400,'Total inválido.');
    const row=(await client.query(`INSERT INTO purchases(number,supplier_id,buyer_id,discount,freight,taxes,total,payment_method,payment_terms,expected_delivery_date,notes,direct_purchase_justification,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[purchaseNumber,payload.supplier_id,user.id,number(payload.discount),number(payload.freight),number(payload.taxes),total,text(payload.payment_method),text(payload.payment_terms),payload.expected_delivery_date||null,text(payload.notes),text(payload.justification),payload.status==='ordered'?'ordered':'preparing'])).rows[0];
    for(const item of payload.items){if(!text(item.description)||!text(item.unit)||number(item.quantity)<=0||number(item.unit_value)<0)throw httpError(400,'Itens da compra direta são inválidos.');await client.query('INSERT INTO purchase_items(purchase_id,description,unit,quantity,unit_value,discount,total) VALUES($1,$2,$3,$4,$5,$6,$7)',[row.id,text(item.description),text(item.unit),number(item.quantity),number(item.unit_value),number(item.discount),number(item.quantity)*number(item.unit_value)-number(item.discount)]);}await logAudit(client,{entityType:'purchase',entityId:row.id,action:'direct_created',newValue:row,userId:user.id});return getPurchaseWithClient(client,row.id,user);
  });
}

export async function listPurchases(filters={},user){
  const {page,limit}=pageParams(filters);const params=[];const where=[];if(filters.status){params.push(filters.status);where.push(`p.status=$${params.length}`);}if(filters.search){params.push(`%${text(filters.search)}%`);where.push(`(p.number ILIKE $${params.length} OR s.legal_name ILIKE $${params.length} OR s.trade_name ILIKE $${params.length})`);}const clause=where.length?`WHERE ${where.join(' AND ')}`:'';const total=(await query(`SELECT COUNT(*)::int total FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ${clause}`,params)).rows[0].total;params.push(limit,(page-1)*limit);
  const rows=(await query(`SELECT p.*,s.legal_name supplier_name,s.trade_name supplier_trade_name,u.name buyer_name,pr.number request_number FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN users u ON u.id=p.buyer_id LEFT JOIN purchase_requests pr ON pr.id=p.purchase_request_id ${clause} ORDER BY p.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;if(!hasPermission(user,'purchases.view_values'))rows.forEach(row=>{delete row.discount;delete row.freight;delete row.taxes;delete row.total;});return{data:rows,pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}

async function getPurchaseWithClient(client,id,user){const result=await client.query(`SELECT p.*,s.legal_name supplier_name,s.trade_name supplier_trade_name,u.name buyer_name,pr.number request_number FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN users u ON u.id=p.buyer_id LEFT JOIN purchase_requests pr ON pr.id=p.purchase_request_id WHERE p.id=$1`,[id]);if(!result.rows[0])throw httpError(404,'Compra não encontrada.');const row=result.rows[0];row.items=(await client.query('SELECT *,quantity-received_quantity pending_quantity FROM purchase_items WHERE purchase_id=$1 ORDER BY created_at',[id])).rows;row.receipts=(await client.query(`SELECT r.*,u.name responsible_name,COALESCE(json_agg(json_build_object('purchase_item_id',ri.purchase_item_id,'quantity',ri.quantity,'has_discrepancy',ri.has_discrepancy,'is_damaged',ri.is_damaged,'is_rejected',ri.is_rejected,'notes',ri.notes)) FILTER(WHERE ri.id IS NOT NULL),'[]') items FROM purchase_receipts r JOIN users u ON u.id=r.responsible_id LEFT JOIN purchase_receipt_items ri ON ri.receipt_id=r.id WHERE r.purchase_id=$1 GROUP BY r.id,u.name ORDER BY r.receipt_date DESC`,[id])).rows;if(!hasPermission(user,'purchases.view_values')){['discount','freight','taxes','total'].forEach(k=>delete row[k]);row.items=row.items.map(({unit_value,discount,total,...item})=>item);}return row;}
export async function getPurchase(id,user){return transaction(client=>getPurchaseWithClient(client,id,user));}

export async function receivePurchase(id,payload,user){const items=Array.isArray(payload.items)?payload.items.filter(i=>number(i.quantity)>0):[];if(!items.length)throw httpError(400,'Informe ao menos uma quantidade recebida.');return transaction(async(client)=>{const purchase=(await client.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!purchase)throw httpError(404,'Compra não encontrada.');if(['cancelled','received'].includes(purchase.status))throw httpError(409,'Esta compra não aceita recebimento.');const currentItems=(await client.query('SELECT * FROM purchase_items WHERE purchase_id=$1 FOR UPDATE',[id])).rows;
    for(const received of items){const item=currentItems.find(i=>i.id===received.purchase_item_id);if(!item)throw httpError(400,'Item inválido.');if(number(received.quantity)>Number(item.quantity)-Number(item.received_quantity))throw httpError(400,`Quantidade excede o pendente de ${item.description}.`);}
    const receipt=(await client.query('INSERT INTO purchase_receipts(purchase_id,receipt_date,responsible_id,notes) VALUES($1,$2,$3,$4) RETURNING *',[id,payload.receipt_date||new Date(),user.id,text(payload.notes)])).rows[0];for(const received of items){await client.query('INSERT INTO purchase_receipt_items(receipt_id,purchase_item_id,quantity,has_discrepancy,is_damaged,is_rejected,notes) VALUES($1,$2,$3,$4,$5,$6,$7)',[receipt.id,received.purchase_item_id,number(received.quantity),Boolean(received.has_discrepancy),Boolean(received.is_damaged),Boolean(received.is_rejected),text(received.notes)]);if(!received.is_rejected)await client.query('UPDATE purchase_items SET received_quantity=received_quantity+$1 WHERE id=$2',[number(received.quantity),received.purchase_item_id]);}
    const pending=(await client.query('SELECT COUNT(*)::int count FROM purchase_items WHERE purchase_id=$1 AND received_quantity<quantity',[id])).rows[0].count;const anyReceived=(await client.query('SELECT COUNT(*)::int count FROM purchase_items WHERE purchase_id=$1 AND received_quantity>0',[id])).rows[0].count;const status=pending===0?'received':anyReceived>0?'partially_received':purchase.status;await client.query('UPDATE purchases SET status=$1,updated_at=NOW() WHERE id=$2',[status,id]);if(purchase.purchase_request_id){const aggregate=(await client.query(`SELECT COUNT(*) FILTER(WHERE status<>'cancelled')::int total,COUNT(*) FILTER(WHERE status='received')::int received,COUNT(*) FILTER(WHERE status IN('received','partially_received'))::int touched FROM purchases WHERE purchase_request_id=$1`,[purchase.purchase_request_id])).rows[0];const requestStatus=aggregate.total>0&&aggregate.received===aggregate.total?'received':aggregate.touched>0?'partially_received':'purchased';await client.query('UPDATE purchase_requests SET status=$1,updated_at=NOW() WHERE id=$2',[requestStatus,purchase.purchase_request_id]);}await client.query("INSERT INTO purchase_domain_events(event_type,aggregate_type,aggregate_id,payload) VALUES('purchase.received','purchase',$1,$2)",[id,JSON.stringify({receipt_id:receipt.id,status})]);await logAudit(client,{entityType:'purchase',entityId:id,action:'receipt_registered',previousValue:{status:purchase.status},newValue:{receipt_id:receipt.id,status,items},userId:user.id});return getPurchaseWithClient(client,id,user);
  });}

export async function cancelPurchase(id,reason,user){if(!text(reason))throw httpError(400,'Motivo é obrigatório.');return transaction(async client=>{const row=(await client.query("UPDATE purchases SET status='cancelled',cancelled_at=NOW(),cancelled_by=$1,cancellation_reason=$2,updated_at=NOW() WHERE id=$3 AND status NOT IN('received','cancelled') RETURNING *",[user.id,text(reason),id])).rows[0];if(!row)throw httpError(409,'Compra não encontrada ou não pode ser cancelada.');await logAudit(client,{entityType:'purchase',entityId:id,action:'cancelled',newValue:{reason:text(reason)},userId:user.id});return row;});}

export async function getPurchaseDashboard(user){const viewValues=hasPermission(user,'purchases.view_values');const result=await query(`SELECT
    (SELECT COUNT(*)::int FROM purchase_requests WHERE status='pending_approval') pending_approval,
    (SELECT COUNT(*)::int FROM purchase_requests WHERE priority='urgent' AND status NOT IN('received','rejected','cancelled')) urgent_requests,
    (SELECT COUNT(*)::int FROM purchase_quote_requests q WHERE q.status IN('sent','responses_received') AND (q.response_deadline IS NULL OR q.response_deadline>=CURRENT_DATE)) quotes_waiting,
    (SELECT COUNT(*)::int FROM purchases WHERE expected_delivery_date<CURRENT_DATE AND status IN('preparing','ordered','partially_received')) overdue_purchases,
    (SELECT COUNT(*)::int FROM purchases WHERE status='partially_received') partially_received,
    (SELECT COUNT(*)::int FROM purchases WHERE created_at>=date_trunc('month',CURRENT_DATE) AND status<>'cancelled') purchases_month,
    ${viewValues?"(SELECT COALESCE(SUM(total),0) FROM purchases WHERE created_at>=date_trunc('month',CURRENT_DATE) AND status<>'cancelled')":"NULL::numeric"} purchased_value_month`);return result.rows[0];}

export async function quoteTextData(id){return getQuoteRequest(id);}
export async function auditQuoteAction(id,user,action='text_copied'){return transaction(async client=>{const exists=await client.query('SELECT 1 FROM purchase_quote_requests WHERE id=$1',[id]);if(!exists.rowCount)throw httpError(404,'Cotação não encontrada.');await logAudit(client,{entityType:'purchase_quote',entityId:id,action,userId:user.id});return{ok:true};});}
