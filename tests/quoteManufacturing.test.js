import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requiredQuantities, multiplyProduction, shouldManufacture, manufactureQuantity } from '../src/utils/manufacturingQuantities.js';
import { normalizeManufacturingPlan } from '../backend/src/services/quoteManufacturingService.js';
const make=()=>({enabled:true,nodes:[{key:randomUUID(),parent_key:null,new_product:{name:'Equipamento fictício',type:'manufactured'},quantity:'1',unit_code:'UN'}]});
test('multiplica todos os níveis e separa o total necessário da decisão operacional',()=>{
 const plan=make(),root=plan.nodes[0];
 plan.nodes.push({key:randomUUID(),parent_key:root.key,quantity:'2',manufacture:false});
 plan.nodes.push({key:randomUUID(),parent_key:plan.nodes[1].key,quantity:'0.25',fabrication_quantity:'0.5'});
 const total=requiredQuantities(plan.nodes,'3');
 assert.deepEqual([...total.values()],['3','6','1.5']);
 assert.equal(manufactureQuantity(plan.nodes[2],total.get(plan.nodes[2].key)),'0.5');
 assert.equal(plan.nodes[1].quantity,'2');assert.equal(shouldManufacture(plan.nodes[1]),false);
});
test('aritmética decimal exata recusa perda de precisão e excesso de capacidade',()=>{
 assert.equal(multiplyProduction('0,1','0.2'),'0.02');
 for(const [a,b] of [['0.000001','0.1'],['999999999999','2'],['1e3','1'],['-1','2']])assert.equal(multiplyProduction(a,b),null);
});
test('comprados e matérias-primas exigem seleção operacional explícita',()=>{
 for(const type of ['resale','material_prima']){assert.equal(shouldManufacture({type}),false);assert.equal(shouldManufacture({type,manufacture:true}),true);}
 assert.equal(shouldManufacture({new_product:{type:'manufactured'}}),true);
});
test('aceita planejamento incompleto, sem persistir intenção de atualizar o estoque',()=>{
 const plan=make();plan.save_tree=true;plan.confirm_replace=true;plan.nodes[0].unit_code='';plan.nodes[0].sector_id=null;
 const normalized=normalizeManufacturingPlan(plan);assert.equal(normalized.save_tree,undefined);assert.equal(normalized.confirm_replace,undefined);assert.equal(normalized.nodes[0].unit_code,'');
});
test('bloqueia referências circulares, órfãos, identificadores e duplicações indevidas',()=>{
 const plan=make();const root=plan.nodes[0];
 assert.throws(()=>normalizeManufacturingPlan({...plan,nodes:[null]}),{status:400});
 assert.throws(()=>normalizeManufacturingPlan({...plan,nodes:[{...root,parent_key:root.key}]}),{status:400});
 const child={key:randomUUID(),parent_key:root.key,product_id:randomUUID(),quantity:'2',unit_code:'UN'};
 assert.throws(()=>normalizeManufacturingPlan({...plan,nodes:[root,child,{...child,key:randomUUID()}]}),/duplicado/);
 assert.throws(()=>normalizeManufacturingPlan({...plan,nodes:[root,{...child,parent_key:randomUUID()}]}),/sem pai/);
 for(const quantity of ['-1','NaN','1e2','0.0000001'])assert.throws(()=>normalizeManufacturingPlan({...plan,nodes:[{...root,quantity}]}),{status:400});
});
