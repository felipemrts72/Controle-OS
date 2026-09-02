import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, ShieldAlert, TriangleAlert } from 'lucide-react';
import { formatMoney } from '../EmployeesPage/employeeUtils.js';
import './AdvanceLimitReview.css';

export function AdvanceLimitReview({ review, busy, error, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const [decisions, setDecisions] = useState({});
  const items = review.review_items;
  const reviewed = items.filter((item) => decisions[item.line_id]).length;
  const overrides = items.filter((item) => item.classification === 'OVERRIDE_REQUIRED').length;
  const rejected = items.filter((item) => decisions[item.line_id] === 'reject').length;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className="advance-review" aria-labelledby="advance-review-title"
      aria-describedby="advance-review-description" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <header className="advance-review__header">
        <h2 id="advance-review-title">Revisão de limites</h2>
        <p id="advance-review-description">Confirme cada pendência antes da aprovação da lista.</p>
        <div className="advance-review__summary">
          <span>{items.length} pendências · {items.length - overrides} avisos · {overrides} overrides</span>
          <strong role="status">{reviewed}/{items.length} revisados</strong>
        </div>
        {review.code === 'LIST_REVIEW_STALE' && <p role="alert" className="advance-review__notice">{review.message}</p>}
      </header>
      <div className="advance-review__scroll" tabIndex={0} aria-label="Pendências de limites">
        {!items.length && <p>Não há mais limites pendentes. Confirme a aprovação com os dados atualizados.</p>}
        {items.map((item) => {
          const override = item.classification === 'OVERRIDE_REQUIRED';
          const decision = decisions[item.line_id];
          return (
            <article key={item.line_id} className={`advance-review__item advance-review__item_${decision || 'pending'}`}>
              <div className="advance-review__item-heading">
                <h3>{item.employee_name}</h3>
                <span className={`advance-review__rule ${override ? 'advance-review__rule_override' : ''}`}>
                  {override ? <ShieldAlert size={15} /> : <TriangleAlert size={15} />}
                  {override ? 'Override obrigatório' : `Atenção · acima de ${item.warning_percentage}%`}
                </span>
              </div>
              <dl className="advance-review__facts">
                <div><dt>Salário</dt><dd>{item.salary ? formatMoney(item.salary) : 'Não cadastrado'}</dd></div>
                <div><dt>Já acumulado</dt><dd>{formatMoney(item.accumulated_before)}</dd></div>
                <div><dt>Novo vale</dt><dd>{formatMoney(item.amount)}</dd></div>
                <div><dt>Projetado</dt><dd>{formatMoney(item.projected_total)}</dd></div>
                <div><dt>Percentual</dt><dd>{item.projected_percentage == null ? '—' : `${Number(item.projected_percentage).toFixed(2).replace('.', ',')}%`}</dd></div>
              </dl>
              {override && <p className="advance-review__reason">{item.salary ? `Limite máximo: ${item.maximum_percentage}% do salário.` : 'Salário ausente: exige autorização especial.'}</p>}
              {!item.can_authorize && <p className="advance-review__notice">Você não tem permissão para autorizar este override.</p>}
              <div className="advance-review__decision">
                <strong className="advance-review__state">{decision === 'approve' ? '✓ Aprovada' : decision === 'reject' ? '✕ Rejeitada' : 'Pendente'}</strong>
                <div role="group" aria-label={`Decisão para ${item.employee_name}`}>
                  <button type="button" className="button" aria-pressed={decision === 'approve'}
                    disabled={busy || !item.can_authorize} onClick={() => setDecisions((current) => ({ ...current, [item.line_id]: 'approve' }))}>
                    <Check size={18} /><span>{override ? 'Aprovar override' : 'Aprovar'}</span>
                  </button>
                  <button type="button" className="button" aria-pressed={decision === 'reject'} disabled={busy}
                    onClick={() => setDecisions((current) => ({ ...current, [item.line_id]: 'reject' }))}>
                    <X size={18} /><span>Rejeitar</span>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <footer className="advance-review__footer">
        <p>{rejected ? `${rejected} rejeitada(s): a lista não será aprovada. Edite ou remova essas linhas depois de confirmar. As demais autorizações não serão salvas.` : 'As autorizações só serão registradas junto com a aprovação da lista.'}</p>
        {error && <p role="alert" className="advance-review__notice">{error}</p>}
        <div>
          <button type="button" className="button" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="button" className="button button_primary" disabled={busy || reviewed !== items.length}
            onClick={() => onConfirm({ review_token: review.review_token, decisions: items.map((item) => ({ line_id: item.line_id, decision: decisions[item.line_id] })) })}>
            {busy ? 'Validando…' : 'Confirmar decisões'}
          </button>
        </div>
      </footer>
    </dialog>, document.body,
  );
}
