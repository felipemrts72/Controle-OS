import { randomUUID } from 'node:crypto';
import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { hasPermission } from './permissionService.js';
import { loadTree, saveProductTree } from './productTreeService.js';
import { logAudit } from './auditService.js';
import { refreshSoldItemStatus, refreshInternalOrderStatus } from './statusService.js';
import { createSaleForApprovedQuote } from './commercialSaleService.js';
import { requiredQuantities, productionDecimal, shouldManufacture, manufactureQuantity } from '../../../src/utils/manufacturingQuantities.js';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const fail = (message) => { throw httpError(400, message); };
const id = value => { if (!uuid.test(String(value))) fail('Identificador inválido no planejamento.'); return value.toLowerCase(); };
const title = node => node.new_product?.name || node.name || 'Componente sem nome';

export async function manufacturingTemplate(client, item) {
  let productId = item.product_id || null;
  if (item.commercial_product_id) productId = (await client.query('SELECT operational_product_id FROM commercial_products WHERE id=$1', [id(item.commercial_product_id)])).rows[0]?.operational_product_id || null;
  if (productId) return { ...(await loadTree(client, id(productId))), enabled: true };
  return { enabled: true, version: 0, product_id: null, nodes: [{ key: randomUUID(), parent_key: null,
    product_id: null, new_product: { name: String(item.name || '').slice(0,220), type: 'manufactured' },
    quantity: '1', unit_code: item.unit || '', sector_id: null, note: '' }] };
}

// Pode guardar pendências de preenchimento; referências e hierarquia continuam validadas.
export function normalizeManufacturingPlan(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw.nodes) || !raw.nodes.length || raw.nodes.length > 2000) fail('Planejamento deve conter de 1 a 2.000 componentes.');
  const nodes = raw.nodes.map(n => {
    if (!n || typeof n !== 'object') fail('Componente inválido no planejamento.');
    const quantity = n.quantity === '' ? '' : productionDecimal(n.quantity);
    if (quantity === null) fail(`Quantidade estrutural inválida: ${title(n)}.`);
    if (n.fabrication_quantity != null && n.fabrication_quantity !== '' && productionDecimal(n.fabrication_quantity) === null) fail(`Quantidade a fabricar inválida: ${title(n)}.`);
    if (n.manufacture !== undefined && typeof n.manufacture !== 'boolean') fail('Seleção de fabricação inválida.');
    return { key: id(n.key), parent_key: n.parent_key ? id(n.parent_key) : null,
      product_id: n.product_id ? id(n.product_id) : null,
      ...(n.product_id ? { name: String(n.name || '').slice(0,220), type: String(n.type || '').slice(0,80) }
        : { new_product: { name: String(n.new_product?.name || '').slice(0,220), type: String(n.new_product?.type || '').slice(0,80) } }),
      quantity, unit_code: String(n.unit_code || '').slice(0,20), sector_id: n.sector_id ? id(n.sector_id) : null,
      note: String(n.note || '').slice(0,1000), manufacture: n.manufacture,
      fabrication_quantity: n.fabrication_quantity == null ? null : String(n.fabrication_quantity).replace(',', '.') };
  });
  const roots = nodes.filter(n=>!n.parent_key), byKey = new Map(nodes.map(n=>[n.key,n]));
  if (roots.length !== 1 || byKey.size !== nodes.length) fail('A composição precisa de uma raiz e identificadores únicos.');
  const siblings = new Set();
  for (const node of nodes) {
    const identity = node.product_id || node.new_product?.name.trim().toLocaleLowerCase();
    const sibling = `${node.parent_key}:${identity}`;
    if (identity && siblings.has(sibling)) fail(`Componente duplicado no mesmo nível: ${title(node)}.`);
    if (identity) siblings.add(sibling);
    const keys = new Set([node.key]), products = new Set(node.product_id ? [node.product_id] : []);
    let parent = node.parent_key;
    while (parent) {
      const p = byKey.get(parent);
      if (!p) fail('Componente sem pai no planejamento.');
      if (keys.has(parent) || (p.product_id && products.has(p.product_id))) fail(`Referência circular: ${title(node)}.`);
      keys.add(parent); if (p.product_id) products.add(p.product_id); parent=p.parent_key;
    }
  }
  return { enabled: raw.enabled === true, version: Number.isInteger(raw.version) ? raw.version : 0,
    product_id: roots[0].product_id, nodes };
}

export async function prepareQuoteManufacturing(client, items, user) {
  const updatedTrees = new Set();
  for (const item of items) {
    const raw = item.manufacturing_plan;
    const plan = normalizeManufacturingPlan(raw);
    item.manufacturing_plan = plan;
    if (!plan) continue;
    const products = new Map((await client.query('SELECT id,name,type FROM products WHERE id=ANY($1::uuid[])', [plan.nodes.map(n=>n.product_id).filter(Boolean)])).rows.map(p=>[p.id,p]));
    for (const node of plan.nodes) {
      if (node.product_id) {
        const product=products.get(node.product_id);
        if (!product) fail(`Produto não encontrado: ${title(node)}.`);
        node.name ||= product.name; node.type ||= product.type;
        node.manufacture ??= product.type === 'manufactured';
      }
    }
    let expectedRoot=item.product_id || null;
    if (item.commercial_product_id) expectedRoot=(await client.query('SELECT operational_product_id FROM commercial_products WHERE id=$1 FOR UPDATE',[item.commercial_product_id])).rows[0]?.operational_product_id || null;
    if (expectedRoot && plan.product_id !== expectedRoot) fail('O produto principal do planejamento não corresponde ao item do orçamento.');
    if (raw.save_tree !== true) continue;
    if (expectedRoot && updatedTrees.has(expectedRoot)) fail('Atualize a árvore de cada produto em apenas um item por salvamento.');
    if (expectedRoot && raw.version > 0 && raw.confirm_replace !== true) fail('Confirme a substituição da árvore existente.');
    const saved = await saveProductTree(expectedRoot, { version: plan.version, request_id: randomUUID(), nodes: plan.nodes }, user, client);
    updatedTrees.add(saved.product_id);
    const options=new Map(plan.nodes.map(n=>[n.key,n]));
    plan.nodes=saved.nodes.map(n=>({ ...n, manufacture: options.get(n.key).manufacture, fabrication_quantity: options.get(n.key).fabrication_quantity }));
    plan.product_id=saved.product_id; plan.version=saved.version;
    if (!expectedRoot && item.commercial_product_id) await client.query('UPDATE commercial_products SET operational_product_id=$1,updated_by=$2,updated_at=NOW() WHERE id=$3 AND operational_product_id IS NULL', [saved.product_id,user.id,item.commercial_product_id]);
    if (!item.commercial_product_id) { item.product_id=saved.product_id; item.item_type='product'; }
    item.tree_saved = true;
  }
}

export async function manufacturingReview(client, quoteId) {
  const quote=(await client.query('SELECT id,status,updated_at,manufacturing_enabled,manufacturing_choice,manufacturing_issued_at FROM commercial_quotes WHERE id=$1',[id(quoteId)])).rows[0];
  if(!quote) throw httpError(404,'Orçamento não encontrado.');
  const order=(await client.query('SELECT id FROM internal_orders WHERE commercial_quote_id=$1',[quoteId])).rows[0];
  if (order) {
    const snapshots=(await client.query(`SELECT it.manufacturing_snapshot FROM internal_tasks it
      JOIN sold_items si ON si.id=it.sold_item_id WHERE si.internal_order_id=$1 AND it.manufacturing_snapshot IS NOT NULL
      ORDER BY si.created_at,it.created_at,it.id`,[order.id])).rows;
    return {...quote,demands:snapshots.map(row=>row.manufacturing_snapshot),errors:[],production_order_id:order.id};
  }
  const items=(await client.query('SELECT id,line_order,product_name_snapshot,quantity,manufacturing_plan FROM commercial_quote_items WHERE commercial_quote_id=$1 ORDER BY line_order',[quoteId])).rows;
  const sectors=new Map((await client.query('SELECT id,name,is_active FROM sectors')).rows.map(s=>[s.id,s]));
  const units=new Set((await client.query('SELECT code FROM measurement_units WHERE is_active=TRUE')).rows.map(u=>u.code));
  const demands=[], errors=[];
  for(const item of items) {
    const plan=item.manufacturing_plan;
    if(!quote.manufacturing_enabled || !plan?.enabled) continue;
    const totals=requiredQuantities(plan.nodes,item.quantity);
    const byKey=new Map(plan.nodes.map(n=>[n.key,n]));
    for(const node of plan.nodes) {
      if(!shouldManufacture(node)) continue;
      const name=title(node), required=totals.get(node.key), amount=manufactureQuantity(node,required), sector=sectors.get(node.sector_id);
      const prefix=`Item ${item.line_order} · ${item.product_name_snapshot} · ${name}`;
      if(name==='Componente sem nome' || !name.trim()) errors.push(`${prefix}: informe o nome.`);
      if(!required || Number(required)<=0) errors.push(`${prefix}: revise as quantidades estruturais e do orçamento (até seis casas decimais).`);
      if(!amount || Number(amount)<=0) errors.push(`${prefix}: informe uma quantidade a fabricar maior que zero.`);
      if(!units.has(node.unit_code)) errors.push(`${prefix}: selecione uma unidade válida.`);
      if(!sector?.is_active) errors.push(`${prefix}: selecione um setor ativo.`);
      const path=[];let parent=byKey.get(node.parent_key);while(parent){path.unshift(title(parent));parent=byKey.get(parent.parent_key);}
      demands.push({ item_id:item.id,line_order:item.line_order,root_name:item.product_name_snapshot,node_key:node.key,parent_key:node.parent_key,
        root_product_id:plan.product_id,
        product_id:node.product_id,name,quantity:amount,required_quantity:required,structural_quantity:node.quantity,
        unit_code:node.unit_code,sector_id:node.sector_id,sector_name:sector?.name || 'Setor não definido',note:node.note,path });
    }
  }
  return { ...quote, demands, errors, production_order_id:order?.id || null };
}

// Corrige apenas o planejamento aprovado antes da emissão, sem reabrir valores comerciais ou a venda.
export async function saveApprovedQuotePlanning(quoteId, body, user) {
  if (!hasPermission(user,'commercial.quotes.edit')) throw httpError(403,'Sem permissão para editar o planejamento.');
  return transaction(async client=>{
    const quote=(await client.query('SELECT * FROM commercial_quotes WHERE id=$1 FOR UPDATE',[id(quoteId)])).rows[0];
    if (!quote || quote.status!=='approved' || quote.manufacturing_issued_at ||
      (await client.query('SELECT 1 FROM internal_orders WHERE commercial_quote_id=$1',[quoteId])).rowCount) {
      throw httpError(409,'O planejamento só pode ser corrigido antes da emissão definitiva. As demandas existentes estão preservadas.');
    }
    if (!body.expected_updated_at || new Date(body.expected_updated_at).getTime()!==new Date(quote.updated_at).getTime()) throw httpError(409,'O orçamento foi atualizado. Reabra o planejamento antes de salvar.');
    const items=(await client.query('SELECT * FROM commercial_quote_items WHERE commercial_quote_id=$1 ORDER BY line_order',[quoteId])).rows;
    if (!Array.isArray(body.items) || body.items.length!==items.length || new Set(body.items.map(i=>i.id)).size!==items.length) fail('Itens do planejamento não correspondem ao orçamento.');
    for (const item of items) {
      const incoming=body.items.find(i=>i.id===item.id);
      if (!incoming) fail('Item não encontrado no orçamento.');
      item.manufacturing_plan=incoming.manufacturing_plan;
    }
    await prepareQuoteManufacturing(client,items,user);
    for (const item of items) await client.query('UPDATE commercial_quote_items SET manufacturing_plan=$1,product_id=$2,item_type=$3 WHERE id=$4',[
      JSON.stringify(item.manufacturing_plan),item.product_id,item.item_type,item.id]);
    await client.query('UPDATE commercial_quotes SET manufacturing_enabled=$1,updated_at=NOW(),updated_by=$2 WHERE id=$3',[body.manufacturing_enabled===true,user.id,quoteId]);
    await client.query(`INSERT INTO commercial_quote_history(commercial_quote_id,action,user_id) VALUES($1,'manufacturing_plan_edited',$2)`,[quoteId,user.id]);
    await logAudit(client,{entityType:'commercial_quote',entityId:quoteId,action:'manufacturing_plan_edited',userId:user.id,newValue:{item_count:items.length}});
    return {saved:true,trees_saved:items.filter(i=>i.tree_saved).length};
  });
}

export async function issueQuoteManufacturing(quoteId, body, user) {
  if(!hasPermission(user,'commercial.quotes.approve')) throw httpError(403,'Sem permissão para emitir orçamento aprovado.');
  if(typeof body?.manufacture!=='boolean' || body.confirmed!==true) fail('Confirme expressamente a emissão com ou sem fabricação.');
  if(body.manufacture && !hasPermission(user,'orders.create')) throw httpError(403,'Sem permissão para gerar demandas de produção.');
  return transaction(async client=>{
    const quote=(await client.query('SELECT * FROM commercial_quotes WHERE id=$1 FOR UPDATE',[id(quoteId)])).rows[0];
    if(!quote || quote.status!=='approved') throw httpError(409,'A emissão definitiva exige orçamento aprovado pelo cliente.');
    const review=await manufacturingReview(client,quoteId);
    if(review.production_order_id) return review;
    if(quote.manufacturing_issued_at) {
      if(quote.manufacturing_choice!==body.manufacture) throw httpError(409,'Este orçamento já teve sua emissão definitiva confirmada.');
      return review;
    }
    if (!body.expected_updated_at || new Date(body.expected_updated_at).getTime()!==new Date(quote.updated_at).getTime()) {
      throw httpError(409,'O planejamento foi atualizado. Feche e abra novamente a conferência antes de emitir.');
    }
    if(body.manufacture && (review.errors.length || !review.demands.length)) throw httpError(400,review.errors.join('\n') || 'Nenhuma demanda selecionada para fabricação.');
    const sale=await createSaleForApprovedQuote(client,quote,user.id);
    if(body.manufacture) {
      const order=(await client.query(`INSERT INTO internal_orders(sale_number,customer_id,customer_name,customer_phone,promised_date,
        delivery_type,destination_city,destination_uf,created_by,commercial_sale_id,commercial_quote_id)
        VALUES($1,$2,$3,$4,NULL,'transportadora',$5,$6,$7,$8,$9) RETURNING id`,
      [`CV-${String(sale.sale_number).padStart(6,'0')}`,quote.customer_id,quote.customer_name_snapshot,quote.customer_snapshot?.phone || null,
        quote.customer_snapshot?.address?.city || null,quote.customer_snapshot?.address?.state || null,user.id,sale.id,quote.id])).rows[0];
      const saleItems=(await client.query('SELECT * FROM commercial_sale_items WHERE commercial_sale_id=$1 ORDER BY line_order',[sale.id])).rows;
      for(const item of saleItems) {
        const demands=review.demands.filter(d=>d.item_id===item.commercial_quote_item_id); if(!demands.length) continue;
        const sold=(await client.query(`INSERT INTO sold_items(internal_order_id,product_id,product_name_snapshot,quantity,commercial_sale_item_id)
          VALUES($1,$2,$3,$4,$5) RETURNING id`,[order.id,demands[0].root_product_id || item.operational_product_id,item.product_name_snapshot,item.quantity,item.id])).rows[0];
        for(const demand of demands) await client.query(`INSERT INTO internal_tasks(sold_item_id,sector_id,task_name,quantity,is_released,
          measurement_unit_code,manufacturing_node_key,manufacturing_parent_key,component_product_id,manufacturing_snapshot,manufacturing_notes)
          VALUES($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10)`,[sold.id,demand.sector_id,
          `${demand.name} — ${demand.root_name}`,demand.quantity,demand.unit_code,demand.node_key,demand.parent_key,demand.product_id,JSON.stringify(demand),demand.note]);
        await client.query("UPDATE commercial_sale_items SET production_status='created',production_reason='Fabricação confirmada na emissão definitiva.' WHERE id=$1",[item.id]);
        await refreshSoldItemStatus(client,sold.id);
      }
      await refreshInternalOrderStatus(client,order.id);
      await logAudit(client,{entityType:'internal_order',entityId:order.id,action:'create_from_quote_plan',newValue:{quote_id:quote.id,demands:review.demands},userId:user.id});
    }
    await client.query("UPDATE commercial_sale_items SET production_reason=$1 WHERE commercial_sale_id=$2 AND production_status='not_requested'",[
      body.manufacture?'Item não selecionado no planejamento de fabricação.':'Emissão definitiva confirmada sem fabricação.',sale.id]);
    await client.query('UPDATE commercial_quotes SET manufacturing_choice=$1,manufacturing_issued_at=NOW(),manufacturing_issued_by=$2 WHERE id=$3',[body.manufacture,user.id,quote.id]);
    await client.query(`INSERT INTO commercial_quote_history(commercial_quote_id,action,user_id,details)
      VALUES($1,$2,$3,$4)`,[quote.id,body.manufacture?'issued_with_manufacturing':'issued_without_manufacturing',user.id,{manufacture:body.manufacture}]);
    await logAudit(client,{entityType:'commercial_quote',entityId:quote.id,action:'manufacturing_issue',newValue:{manufacture:body.manufacture},userId:user.id});
    return manufacturingReview(client,quoteId);
  });
}
