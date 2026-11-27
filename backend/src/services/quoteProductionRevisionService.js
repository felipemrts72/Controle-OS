import { quoteProductionTaskName, isLegacyQuoteTaskName } from './quoteProductionTaskNameService.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { refreshSoldItemStatus, refreshInternalOrderStatus } from './statusService.js';

const identity=d=>`${d.item_id}:${d.node_key}`;
const taskValues=d=>[quoteProductionTaskName(d),String(Number(d.quantity)),d.sector_id,d.unit_code,d.product_id || null,d.note || '',d.parent_key || null];
const dependencyValues=d=>(d.dependencies || []).map(x=>`${x.node_key}:${Number(x.quantity)}`).sort();

// Only unused tasks can change. Execution records and their already-used dependency edges remain intact.
export async function syncQuoteProduction(client, order, demands, body, user) {
  const sold=(await client.query('SELECT si.*,csi.commercial_quote_item_id FROM sold_items si LEFT JOIN commercial_sale_items csi ON csi.id=si.commercial_sale_item_id WHERE si.internal_order_id=$1 ORDER BY si.id FOR UPDATE OF si',[order.id])).rows;
  const legacy=(await client.query('SELECT 1 FROM internal_tasks t JOIN sold_items si ON si.id=t.sold_item_id WHERE si.internal_order_id=$1 AND t.manufacturing_node_key IS NULL AND si.commercial_sale_item_id IS NOT NULL LIMIT 1',[order.id])).rowCount;
  if(legacy || sold.some(item=>!item.commercial_sale_item_id && demands.some(d=>d.root_product_id && d.root_product_id===item.product_id))) throw httpError(409,'Esta ordem contém produção antiga ou itens alterados fora do planejamento comercial. Sua composição foi preservada. Corrija a data ou revise os itens pela ordem existente.');
  const tasks=(await client.query(`SELECT t.*,EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity_type='internal_task' AND a.entity_id=t.id AND a.action IN ('mark_ready','mark_pending','mark_ready_auto','pin','unpin')) AS has_execution_history
    FROM internal_tasks t JOIN sold_items si ON si.id=t.sold_item_id WHERE si.internal_order_id=$1 AND t.manufacturing_node_key IS NOT NULL ORDER BY t.id FOR UPDATE OF t`,[order.id])).rows;
  const edges=(await client.query(`SELECT d.*,child.manufacturing_node_key AS child_key FROM internal_task_dependencies d JOIN internal_tasks parent ON parent.id=d.task_id JOIN internal_tasks child ON child.id=d.depends_on_task_id JOIN sold_items si ON si.id=parent.sold_item_id WHERE si.internal_order_id=$1`,[order.id])).rows;
  const desired=new Map(demands.map(d=>[identity(d),d]));
  const changes=[];
  const used=t=>t.status!=='pending' || Number(t.completed_quantity)>0 || t.completed_by || t.completed_at || t.is_pinned || t.pinned_at || t.has_execution_history;
  for(const task of tasks) {
    const old=task.manufacturing_snapshot, demand=desired.get(identity(old));
    const oldValues=[isLegacyQuoteTaskName(task)?quoteProductionTaskName(task.manufacturing_snapshot):task.task_name,String(Number(task.quantity)),task.sector_id,task.measurement_unit_code,task.component_product_id || null,task.manufacturing_notes || '',task.manufacturing_parent_key || null];
    const oldDeps=edges.filter(e=>e.task_id===task.id).map(e=>`${e.child_key}:${Number(e.required_quantity)}`).sort();
    const changed=!demand || JSON.stringify(oldValues)!==JSON.stringify(taskValues(demand)) || JSON.stringify(oldDeps)!==JSON.stringify(dependencyValues(demand));
    if(changed && used(task)) throw httpError(409,`A demanda "${task.task_name}" já possui andamento ou histórico de execução. Sua composição, quantidade, setor e dependências foram preservados. Corrija somente tarefas ainda não iniciadas.`);
    if(changed) changes.push(task);
  }
  const existing=new Map(tasks.map(t=>[identity(t.manufacturing_snapshot),t]));
  const additions=demands.filter(d=>!existing.has(identity(d)));
  if((changes.length || additions.length) && body.confirm_production_changes!==true) throw httpError(409,'Confirme a aplicação das alterações às tarefas ainda não iniciadas.');
  if(!changes.length && !additions.length) return;
  if (['deleted','shipped','partially_shipped'].includes(order.status)) throw httpError(409,'A composição desta ordem não pode ser revisada após exclusão ou expedição. Corrija apenas a data.');
  // Save removed task snapshots and dependency history before deleting only unused operational records.
  for(const task of changes) await logAudit(client,{entityType:'internal_task',entityId:task.id,action:'revise_quote_plan',previousValue:{...task,dependencies:edges.filter(e=>e.task_id===task.id)},newValue:desired.get(identity(task.manufacturing_snapshot)) || {removed:true},userId:user.id});
  for(const task of changes) await client.query('DELETE FROM internal_task_dependencies WHERE task_id=$1',[task.id]);
  for(const task of changes.filter(t=>!desired.has(identity(t.manufacturing_snapshot)))) await client.query('DELETE FROM internal_tasks WHERE id=$1',[task.id]);
  const ids=new Map(tasks.filter(t=>desired.has(identity(t.manufacturing_snapshot))).map(t=>[identity(t.manufacturing_snapshot),t.id]));
  for(const demand of demands) {
    const previous=existing.get(identity(demand));
    if(previous && !changes.some(t=>t.id===previous.id)) continue;
    let item=sold.find(si=>si.commercial_quote_item_id===demand.item_id);
    if(!item) {
      const saleItem=(await client.query('SELECT * FROM commercial_sale_items WHERE commercial_sale_id=$1 AND commercial_quote_item_id=$2',[order.commercial_sale_id,demand.item_id])).rows[0];
      if(!saleItem) throw httpError(409,'Item comercial não encontrado para a revisão da produção.');
      item=(await client.query(`INSERT INTO sold_items(internal_order_id,product_id,product_name_snapshot,quantity,commercial_sale_item_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,[order.id,demand.root_product_id || saleItem.operational_product_id,saleItem.product_name_snapshot,saleItem.quantity,saleItem.id])).rows[0];
      item.commercial_quote_item_id=demand.item_id;sold.push(item);
      const product=(await client.query('SELECT default_volume_quantity,default_total_weight_kg FROM products WHERE id=$1',[item.product_id])).rows[0];
      const volumes=Number(product?.default_volume_quantity),total=volumes*Number(item.quantity);
      if(volumes>0 && Number.isInteger(total) && Number(product.default_total_weight_kg)>0) await client.query(`INSERT INTO shipment_volumes(sold_item_id,volume_number,total_volumes,weight_kg,description,label_status) SELECT $1,n,$2,$3,$4,'waiting_tasks' FROM generate_series(1,$2::int) n`,[item.id,total,Number(product.default_total_weight_kg)/volumes,item.product_name_snapshot]);
    }
    const values=[item.id,demand.sector_id,quoteProductionTaskName(demand),demand.quantity,demand.unit_code,demand.node_key,demand.parent_key,demand.product_id,JSON.stringify(demand),demand.note];
    if(previous) {
      await client.query(`UPDATE internal_tasks SET sold_item_id=$1,sector_id=$2,task_name=$3,quantity=$4,measurement_unit_code=$5,manufacturing_node_key=$6,manufacturing_parent_key=$7,component_product_id=$8,manufacturing_snapshot=$9,manufacturing_notes=$10,updated_at=clock_timestamp() WHERE id=$11`,[...values,previous.id]);
    } else {
      const task=(await client.query(`INSERT INTO internal_tasks(sold_item_id,sector_id,task_name,quantity,measurement_unit_code,manufacturing_node_key,manufacturing_parent_key,component_product_id,manufacturing_snapshot,manufacturing_notes,is_released) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE) RETURNING id`,values)).rows[0];
      ids.set(identity(demand),task.id);
      await logAudit(client,{entityType:'internal_task',entityId:task.id,action:'add_from_quote_revision',newValue:demand,userId:user.id});
    }
  }
  for(const demand of demands) {
    const previous=existing.get(identity(demand));
    if(previous && !changes.some(t=>t.id===previous.id)) continue;
    for(const dep of demand.dependencies) await client.query('INSERT INTO internal_task_dependencies(task_id,depends_on_task_id,required_quantity) VALUES($1,$2,$3)',[ids.get(identity(demand)),ids.get(`${demand.item_id}:${dep.node_key}`),dep.quantity]);
  }
  await client.query(`UPDATE internal_tasks t SET is_released=NOT EXISTS(SELECT 1 FROM internal_task_dependencies d JOIN internal_tasks child ON child.id=d.depends_on_task_id WHERE d.task_id=t.id AND (child.status<>'ready' OR child.completed_quantity<d.required_quantity)) WHERE t.sold_item_id=ANY($1::uuid[]) AND t.status='pending' AND t.manufacturing_node_key IS NOT NULL`,[sold.map(si=>si.id)]);
  for(const item of sold) {
    await client.query(`UPDATE commercial_sale_items SET production_status=CASE WHEN EXISTS(SELECT 1 FROM internal_tasks WHERE sold_item_id=$1) THEN 'created' ELSE 'not_requested' END,production_reason='Planejamento operacional revisado.' WHERE id=$2`,[item.id,item.commercial_sale_item_id]);
    await refreshSoldItemStatus(client,item.id);
  }
  await refreshInternalOrderStatus(client,order.id);
  await logAudit(client,{entityType:'internal_order',entityId:order.id,action:'revise_quote_production',previousValue:{tasks},newValue:{demands},userId:user.id});
}
