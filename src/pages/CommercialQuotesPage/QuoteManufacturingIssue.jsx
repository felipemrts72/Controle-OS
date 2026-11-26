import { useEffect, useRef, useState } from 'react';
import './QuoteManufacturing.css';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';

export function QuoteManufacturingIssue({ quoteId, onClose, onIssued, consultOnly = false, onEdit }) {
  const [review,setReview]=useState(null),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
  const pending=useRef(false);
  useEffect(()=>{api.get(`/commercial/quotes/${quoteId}/manufacturing`).then(r=>setReview(r.data)).catch(e=>setError(e.response?.data?.message || 'Não foi possível carregar a conferência.'));},[quoteId]);
  async function issue(manufacture) {
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try { const {data}=await api.post(`/commercial/quotes/${quoteId}/manufacturing/issue`,{manufacture,confirmed:true,expected_updated_at:review.updated_at});setReview(data);setConfirm(false);onIssued?.(); }
    catch(e){setError(e.response?.data?.message || 'Falha na emissão; confira e tente novamente.');}
    finally{pending.current=false;setBusy(false);}
  }
  const finished=review?.manufacturing_issued_at || review?.production_order_id;
  return <ConfirmModal open title={consultOnly?'Fabricação vinculada':'Deseja gerar o processo de fabricação deste orçamento?'} onCancel={()=>{if(!busy)onClose();}} cancelLabel={finished || consultOnly?'Fechar':'Cancelar'} contentClassName="quote-manufacturing-confirm">
    {error && <p role="alert" style={{whiteSpace:'pre-line',color:'#a32020'}}>{error}</p>}
    {!review && !error && <p>Carregando conferência…</p>}
    {review && <>
      {finished && <p>{review.production_order_id?'Fabricação já gerada. As demandas existentes estão preservadas.':'Emissão definitiva confirmada sem fabricação.'}</p>}
      {review.production_order_id && <Link className="button" to={`/os/${review.production_order_id}`}>Consultar fabricação vinculada</Link>}
      {!finished && onEdit && review.errors.length>0 && <button type="button" className="button" disabled={busy} onClick={onEdit}>Corrigir planejamento</button>}
      {review.errors.map((message,i)=><p role="alert" key={i}>{message}</p>)}
      {(confirm || consultOnly) && [...new Set(review.demands.map(d=>d.sector_name))].map(sector=><section key={sector}><h3>{sector}</h3>{review.demands.filter(d=>d.sector_name===sector).map(d=><p key={`${d.item_id}:${d.node_key}`}><strong>{d.parent_key ? [d.root_name,...d.path.slice(1),d.name].join(' → ') : d.root_name}</strong><br/>Necessário: {Number(d.required_quantity).toLocaleString('pt-BR',{maximumFractionDigits:6})} {d.unit_code} · Fabricar: {Number(d.quantity).toLocaleString('pt-BR',{maximumFractionDigits:6})} {d.unit_code}{d.note && <><br/>{d.note}</>}</p>)}</section>)}
      {!finished && !consultOnly && <div className="page__actions">
        {!confirm ? <><button type="button" className="button button_primary" disabled={busy || !review.demands.length || review.errors.length>0} onClick={()=>setConfirm(true)}>Emitir com fabricação</button><button type="button" className="button" disabled={busy} onClick={()=>issue(false)}>Emitir sem fabricação</button></>
          : <><button type="button" className="button" disabled={busy} onClick={()=>onEdit ? onEdit() : setConfirm(false)}>Voltar e corrigir</button><button type="button" className="button button_primary" disabled={busy} onClick={()=>issue(true)}>Confirmar emissão e gerar fabricação</button></>}
      </div>}
    </>}
  </ConfirmModal>;
}
