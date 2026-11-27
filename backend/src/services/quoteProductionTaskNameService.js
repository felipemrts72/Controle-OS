import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { hasPermission } from './permissionService.js';
import { logAudit } from './auditService.js';

export const quoteProductionTaskName=demand=>demand.name;
export function isLegacyQuoteTaskName(task) {
  const snapshot=task.manufacturing_snapshot;
  return Boolean(snapshot && task.manufacturing_node_key===snapshot.node_key && (task.manufacturing_parent_key || null)===(snapshot.parent_key || null)
    && task.task_name===`${snapshot.name} — ${snapshot.root_name}`);
}

// Explicit, quote-scoped text repair. Execution, snapshots, dependencies and commercial records are untouched.
export async function correctQuoteProductionNames(quoteId, body, user) {
  if(!hasPermission(user,'commercial.quotes.edit') || !hasPermission(user,'orders.edit')) throw httpError(403,'Sem permissão para corrigir nomes de demandas desta ordem.');
  if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(String(quoteId))) throw httpError(400,'Orçamento inválido.');
  if(body?.confirmed!==true) throw httpError(400,'Confirme a correção dos nomes das demandas.');
  return transaction(async client=>{
    const quote=(await client.query('SELECT id,updated_at FROM commercial_quotes WHERE id=$1 FOR UPDATE',[quoteId])).rows[0];
    if(!quote) throw httpError(404,'Orçamento não encontrado.');
    if(!body.expected_updated_at || new Date(body.expected_updated_at).getTime()!==new Date(quote.updated_at).getTime()) throw httpError(409,'O orçamento foi atualizado. Reabra a conferência.');
    let order=(await client.query('SELECT * FROM internal_orders WHERE commercial_quote_id=$1',[quoteId])).rows[0];
    if(!order || order.status==='deleted') throw httpError(409,'Nenhuma ordem ativa vinculada a este orçamento.');
    await client.query('SELECT id FROM sold_items WHERE internal_order_id=$1 ORDER BY id FOR UPDATE',[order.id]);
    order=(await client.query('SELECT * FROM internal_orders WHERE id=$1 FOR UPDATE',[order.id])).rows[0];
    if(order.status==='deleted') throw httpError(409,'A ordem foi excluída. Seus registros foram preservados.');
    if(!body.expected_order_updated_at || new Date(body.expected_order_updated_at).getTime()!==new Date(order.updated_at).getTime()) throw httpError(409,'A ordem foi atualizada. Reabra a conferência.');
    const tasks=(await client.query(`SELECT t.*,qi.id AS quote_item_id,qi.manufacturing_plan AS quote_plan FROM internal_tasks t
      JOIN sold_items si ON si.id=t.sold_item_id
      JOIN commercial_sale_items csi ON csi.id=si.commercial_sale_item_id
      JOIN commercial_quote_items qi ON qi.id=csi.commercial_quote_item_id
      WHERE si.internal_order_id=$1 AND t.manufacturing_node_key IS NOT NULL AND qi.commercial_quote_id=$2 AND csi.commercial_sale_id=$3 ORDER BY t.id FOR UPDATE OF t`,[order.id,quoteId,order.commercial_sale_id])).rows;
    const changes=[];
    for(const task of tasks) {
      const snapshot=task.manufacturing_snapshot;
      if(!snapshot || task.manufacturing_node_key!==snapshot.node_key || (task.manufacturing_parent_key || null)!==(snapshot.parent_key || null)) continue;
      const nodes=(Array.isArray(task.quote_plan?.nodes)?task.quote_plan.nodes:[]).filter(node=>node.key===task.manufacturing_node_key);
      if(nodes.length!==1 || snapshot.item_id!==task.quote_item_id) continue;
      const node=nodes[0],name=node.new_product?.name || node.name;
      if(name!==snapshot.name || (node.parent_key || null)!==(snapshot.parent_key || null) || (node.product_id || null)!==(task.component_product_id || null)) continue;
      if(!name || name===task.task_name) continue;
      await client.query('UPDATE internal_tasks SET task_name=$1,updated_at=clock_timestamp() WHERE id=$2',[name,task.id]);
      const change={task_id:task.id,previous_name:task.task_name,task_name:name};changes.push(change);
      await logAudit(client,{entityType:'internal_task',entityId:task.id,action:'correct_quote_task_name',previousValue:{task_name:task.task_name},newValue:{task_name:name,quote_id:quoteId},userId:user.id});
    }
    if(changes.length) {
      await client.query('UPDATE internal_orders SET updated_at=clock_timestamp() WHERE id=$1',[order.id]);
      await logAudit(client,{entityType:'internal_order',entityId:order.id,action:'correct_quote_task_names',newValue:{quote_id:quoteId,changes},userId:user.id});
      await client.query(`INSERT INTO commercial_quote_history(commercial_quote_id,action,user_id,details) VALUES($1,'manufacturing_task_names_corrected',$2,$3)`,[quoteId,user.id,{production_order_id:order.id,changes}]);
    }
    return {corrected:changes.length,production_order_id:order.id};
  });
}
