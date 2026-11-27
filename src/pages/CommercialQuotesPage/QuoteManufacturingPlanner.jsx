import { ProductTreeEditor } from '../../components/ProductTreeEditor/ProductTreeEditor.jsx';

export function QuoteManufacturingPlanner({ items, setItems, enabled, setEnabled, onClose, onSave, saving, approved = false }) {
  function update(index, plan) { setItems(current=>current.map((item,i)=>i===index?{...item,manufacturing_plan:plan}:item)); }
  return <section className="page"><header className="page__header"><div><h1 className="page__title">Planejamento de fabricação</h1><p>As demandas serão geradas ao converter em venda com fabricação ou ao gerar a ordem de uma venda existente.</p></div><button className="button" type="button" onClick={onClose}>Voltar ao orçamento</button></header>
    <label className="panel"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> Este orçamento deverá gerar fabricação</label>
    {items.map((item,index)=><section className="panel" key={item._planningKey || index} style={{minWidth:0}}>
      <h2>{index+1}. {item.name} · {item.quantity} {item.unit}</h2>
      <label><input type="checkbox" checked={item.manufacturing_plan?.enabled===true} onChange={e=>update(index,{...item.manufacturing_plan,enabled:e.target.checked})} /> Incluir este produto na fabricação</label>
      <ProductTreeEditor planning={item.manufacturing_plan} quoteQuantity={item.quantity} onPlanChange={plan=>update(index,{...plan,enabled:item.manufacturing_plan.enabled,save_tree:item.manufacturing_plan.save_tree})} />
      <label><input type="checkbox" checked={item.manufacturing_plan?.save_tree===true} onChange={e=>update(index,{...item.manufacturing_plan,save_tree:e.target.checked})} /> Salvar também a árvore no cadastro do produto</label>
      <p><small>Desmarcada: a composição será exclusiva deste orçamento. Marcada: salva a composição por unidade, independentemente das quantidades selecionadas para fabricação.</small></p>
    </section>)}
    <button className="button button_primary" type="button" disabled={saving} onClick={onSave}>{saving?'Salvando…':approved?'Salvar planejamento':'Salvar orçamento e planejamento'}</button>
  </section>;
}
