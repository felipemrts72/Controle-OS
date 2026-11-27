import { useEffect, useRef, useState } from 'react';
import './QuoteManufacturing.css';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';

export function QuoteManufacturingIssue({ quoteId, onClose, onIssued, consultOnly = false, onEdit, converting = false }) {
  const [review,setReview]=useState(null),[error,setError]=useState(''),[manufacture,setManufacture]=useState(false),[busy,setBusy]=useState(false);
  const pending=useRef(false);
  const canProduce=canAccessPermission(getStoredUser(),'orders.create');
  useEffect(()=>{api.get(`/commercial/quotes/${quoteId}/manufacturing`).then(r=>{
    setReview(r.data);setManufacture(converting ? r.data.manufacturing_enabled : true);
  }).catch(e=>setError(e.response?.data?.message || 'Não foi possível carregar a conferência.'));},[quoteId,converting]);
  async function confirm() {
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    const body={manufacture,confirmed:true,expected_updated_at:review.updated_at};
    try {
      if(converting) await api.patch(`/commercial/quotes/${quoteId}/status`,{...body,status:'approved'});
      else await api.post(`/commercial/quotes/${quoteId}/manufacturing/issue`,body);
      await onIssued?.();onClose();
    } catch(e){setError(e.response?.data?.message || 'Falha ao confirmar. Confira o planejamento e tente novamente.');}
    finally{pending.current=false;setBusy(false);}
  }
  const finished=review?.production_order_id;
  const blocked=manufacture && (!canProduce || !review?.demands.length || review?.errors.length>0);
  return <ConfirmModal open title={consultOnly?'Fabricação vinculada':converting?'Converter em venda':'Gerar ordem de produção'} onCancel={()=>{if(!busy)onClose();}} cancelLabel={finished || consultOnly?'Fechar':'Cancelar'} contentClassName="quote-manufacturing-confirm">
    {error && <p role="alert" style={{whiteSpace:'pre-line',color:'#a32020'}}>{error}</p>}
    {!review && !error && <p>Carregando conferência…</p>}
    {review && <>
      {finished && <Link className="button" to={`/os/${review.production_order_id}`}>Abrir ordem de produção</Link>}
      {!finished && !consultOnly && <>
        <p>{converting?'A confirmação aprova este orçamento e cria a venda.':'A produção será vinculada à venda existente.'} A emissão do PDF é independente desta confirmação.</p>
        <label><input type="checkbox" checked={manufacture} disabled={busy || !converting} onChange={e=>setManufacture(e.target.checked)} /> Gerar ordem de produção</label>
        {converting && !manufacture && <p>A venda será confirmada sem fabricação. Você poderá gerar a ordem posteriormente.</p>}
        {manufacture && !canProduce && <p role="alert">Sem permissão para gerar ordens de produção. Solicite a permissão ou converta explicitamente sem fabricação.</p>}
        {onEdit && <button type="button" className="button" disabled={busy} onClick={onEdit}>Revisar planejamento de fabricação</button>}
        {manufacture && !review.demands.length && <p role="alert">Nenhuma demanda selecionada. Habilite a fabricação e selecione os componentes no planejamento.</p>}
        {manufacture && review.errors.map((message,i)=><p role="alert" key={i}>{message}</p>)}
      </>}
      {(manufacture || consultOnly) && [...new Set(review.demands.map(d=>d.sector_name))].map(sector=><section key={sector}><h3>{sector}</h3>{review.demands.filter(d=>d.sector_name===sector).map(d=><p key={`${d.item_id}:${d.node_key}`}><strong>{d.parent_key ? [d.root_name,...d.path.slice(1),d.name].join(' → ') : d.root_name}</strong><br/>Necessário: {Number(d.required_quantity).toLocaleString('pt-BR',{maximumFractionDigits:6})} {d.unit_code} · Fabricar: {Number(d.quantity).toLocaleString('pt-BR',{maximumFractionDigits:6})} {d.unit_code}<br/>{d.status==='ready'?'Concluído':d.is_released===true?'Liberado para fabricação':d.is_released===false || d.dependencies?.length?'Aguardando componentes':'Liberado para fabricação'}{d.note && <><br/>{d.note}</>}</p>)}</section>)}
      {!finished && !consultOnly && <button type="button" className="button button_primary" disabled={busy || blocked} onClick={confirm}>{busy?'Confirmando…':converting?'Confirmar conversão em venda':'Confirmar e gerar ordem de produção'}</button>}
    </>}
  </ConfirmModal>;
}
