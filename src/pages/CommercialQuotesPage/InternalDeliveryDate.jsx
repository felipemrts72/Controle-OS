export function InternalDeliveryDate({value,onChange,required=false,disabled=false}) {
  return <label className="field"><span className="field__label">Data prevista de entrega — uso interno</span><input className="field__input" type="date" value={value || ''} required={required} disabled={disabled} onChange={e=>onChange(e.target.value)} /><small>Não aparece no PDF comercial. Obrigatória para gerar produção.</small></label>;
}
