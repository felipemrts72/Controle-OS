const comparable=value=>String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
const uuid=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

// Resolve only active, unambiguous catalog entries. Never invent a unit or overwrite a valid plan choice.
export function planningUnitCode(value, units) {
  const input=comparable(value);
  if(!input) return null;
  const code=units.find(unit=>comparable(unit.code)===input);
  if(code) return code.code;
  const matches=units.filter(unit=>[unit.id,unit.name,unit.symbol,...(unit.aliases || [])].some(alias=>alias!=null && comparable(alias)===input));
  return matches.length===1 ? matches[0].code : null;
}

export async function recoverPlanningUnits(client, items) {
  if(!items.some(item=>Array.isArray(item.manufacturing_plan?.nodes))) return [];
  const units=(await client.query('SELECT id,code,name,symbol,aliases FROM measurement_units WHERE is_active=TRUE')).rows;
  const commercialIds=[...new Set(items.map(item=>item.commercial_product_id).filter(value=>uuid.test(String(value))))];
  const links=new Map(commercialIds.length ? (await client.query('SELECT id,operational_product_id FROM commercial_products WHERE id=ANY($1::uuid[])',[commercialIds])).rows.map(p=>[p.id,p.operational_product_id]) : []);
  const productIds=[...new Set(items.flatMap(item=>[item.product_id,links.get(item.commercial_product_id?.toLowerCase()),...(Array.isArray(item.manufacturing_plan?.nodes) ? item.manufacturing_plan.nodes : []).map(node=>node?.product_id)]).filter(value=>uuid.test(String(value))))];
  const products=new Map(productIds.length ? (await client.query('SELECT id,measurement_unit_code FROM products WHERE id=ANY($1::uuid[])',[productIds])).rows.map(p=>[p.id,p.measurement_unit_code]) : []);
  const changed=[];
  for(const item of items) {
    if(!Array.isArray(item.manufacturing_plan?.nodes)) continue;
    let updated=false;
    for(const node of item.manufacturing_plan.nodes) {
      if(!node) continue;
      const productId=node.product_id || (!node.parent_key ? item.product_id || links.get(item.commercial_product_id?.toLowerCase()) : null);
      const code=planningUnitCode(node.unit_code,units)
        || planningUnitCode(products.get(String(productId).toLowerCase()),units)
        || (!node.parent_key ? planningUnitCode(item.measurement_unit_snapshot || item.unit,units) : null);
      if(code && code!==node.unit_code) {node.unit_code=code;updated=true;}
    }
    if(updated) changed.push(item);
  }
  return changed;
}
