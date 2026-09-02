import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, Download, Eye, Pencil, Printer, RotateCcw, Send, XCircle } from 'lucide-react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { formatDate, formatMoney, PAYMENT_TYPES, quoteCommercialLabel, QUOTE_STATUS } from './quoteUi.js';
import { downloadAuthenticatedFile, printAuthenticatedPdf, viewAuthenticatedPdf } from '../../utils/downloadAuthenticatedFile.js';
import './CommercialQuotes.css';

const historyLabels = { created: 'Orçamento criado', edited: 'Rascunho editado', sent: 'Marcado como enviado', reopened: 'Reaberto como rascunho', approved: 'Aprovado comercialmente', rejected: 'Recusado', cancelled: 'Cancelado', duplicated: 'Duplicado de outro orçamento' };

export function QuoteDetailPage({ legacy = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'commercial.quotes.create');
  const canEdit = canAccessPermission(user, 'commercial.quotes.edit');
  const canApprove = canAccessPermission(user, 'commercial.quotes.approve');
  const canCancel = canAccessPermission(user, 'commercial.quotes.cancel');
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pdfAction, setPdfAction] = useState('');

  const load = useCallback(async () => {
    try { setLoading(true); setQuote((await api.get(legacy ? `/commercial/quotes/legacy/${id}` : `/commercial/quotes/${id}`)).data); }
    catch (requestError) { toast.error(requestError.response?.data?.message || 'Não foi possível carregar o orçamento.'); }
    finally { setLoading(false); }
  }, [id, legacy, toast]);
  useEffect(() => { load(); }, [load]);

  async function changeStatus() {
    if (!action?.status) return;
    try {
      setSaving(true);
      await api.patch(`/commercial/quotes/${id}/status`, { status: action.status });
      toast.success(action.success);
      setAction(null);
      await load();
    } catch (requestError) { toast.error(requestError.response?.data?.message || 'Não foi possível alterar o status.'); }
    finally { setSaving(false); }
  }

  async function duplicate() {
    try {
      setSaving(true);
      const response = await api.post(legacy ? `/commercial/quotes/legacy/${id}/duplicate` : `/commercial/quotes/${id}/duplicate`);
      toast.success(`${quoteCommercialLabel(response.data)} criado como rascunho.`);
      navigate(`/comercial/orcamentos/${response.data.id}`);
    } catch (requestError) { toast.error(requestError.response?.data?.message || 'Não foi possível duplicar o orçamento.'); }
    finally { setSaving(false); }
  }

  async function handlePdf(kind) {
    try {
      setPdfAction(kind);
      const path = legacy ? `/commercial/quotes/legacy/${id}/pdf` : `/commercial/quotes/${id}/pdf`;
      const suffix = legacy ? '-Historico-Reconstruido' : '';
      if (kind === 'download') await downloadAuthenticatedFile(`${path}?download=1`, `Orcamento-${quote.commercial_number ?? 'Sem-Numero-Comercial'}${suffix}.pdf`);
      else if (kind === 'print') await printAuthenticatedPdf(path);
      else await viewAuthenticatedPdf(path);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || requestError.message || 'Não foi possível abrir o PDF.');
    } finally { setPdfAction(''); }
  }

  if (loading) return <section className="page"><div className="panel">Carregando orçamento...</div></section>;
  if (!quote) return <section className="page"><div className="panel">Orçamento não encontrado.</div></section>;
  const status = legacy ? { label: 'ERP antigo', tone: 'muted' } : QUOTE_STATUS[quote.status] || { label: quote.status, tone: 'neutral' };
  const customerAddress = quote.customer_snapshot?.address || {};
  const itemsColumns = [
    { key: 'order', label: '#', render: (row) => row.line_order },
    { key: 'item', label: 'Item', render: (row) => <div className="commercial-quotes__identity"><strong>{row.product_name_snapshot}</strong><span>{[row.product_code_snapshot, row.measurement_unit_snapshot, row.item_type === 'manual' ? 'Item manual' : 'Produto cadastrado'].filter(Boolean).join(' · ')}</span>{row.description_snapshot && <span>{row.description_snapshot}</span>}{row.sop_minimum_price_snapshot != null && <span className={row.is_outside_sop ? 'commercial-quotes__outside-sop' : 'commercial-quotes__inside-sop'}>{row.is_outside_sop ? 'Fora da SOP registrada' : 'Dentro da SOP registrada'} · referência {formatMoney(row.reference_price_snapshot)} · mínimo {formatMoney(row.sop_minimum_price_snapshot)}</span>}</div> },
    { key: 'quantity', label: 'Qtd.', render: (row) => Number(row.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) },
    { key: 'unit_price', label: 'Unitário', render: (row) => formatMoney(row.unit_price) },
    { key: 'discount', label: 'Desconto', render: (row) => formatMoney(row.discount_amount) },
    { key: 'subtotal', label: 'Subtotal', render: (row) => <strong>{formatMoney(row.subtotal)}</strong> },
  ];

  return (
    <section className="page commercial-quote-detail">
      <header className="page__header">
        <div><div className="commercial-quote-detail__title-line"><h1 className="page__title">{quoteCommercialLabel(quote)}</h1><span className={`commercial-quotes__status commercial-quotes__status_${status.tone}`}>{status.label}</span></div>{legacy ? <p className="commercial-quotes__subtitle">Origem: ERP Universal · Número original no ERP: #{quote.source_legacy_number}</p> : <p className="commercial-quotes__subtitle">Responsável: {quote.responsible_name || '-'} · Identificador técnico: {quote.quote_number}</p>}</div>
        <div className="page__actions commercial-quote-detail__header-actions"><Link className="button" to="/comercial/orcamentos"><ArrowLeft size={18} /> Voltar</Link>{!legacy && canEdit && quote.status === 'draft' && <Link className="button" to={`/comercial/orcamentos/${id}/editar`}><Pencil size={17} /> Editar</Link>}{canCreate && <button className="button" type="button" disabled={saving} onClick={duplicate}><Copy size={17} /> {legacy ? 'Duplicar para novo orçamento' : 'Duplicar'}</button>}</div>
      </header>

      <div className="commercial-quote-detail__actions">
        <button aria-label={legacy ? 'Visualizar PDF histórico reconstruído' : quote.status === 'draft' ? 'Visualizar PDF' : 'Visualizar PDF oficial'} className="button button_primary commercial-quote-detail__pdf-primary" type="button" disabled={Boolean(pdfAction)} onClick={() => handlePdf('view')}><Eye size={17} /> Visualizar PDF</button>
        <button className="button commercial-quote-detail__pdf-secondary" type="button" disabled={Boolean(pdfAction)} onClick={() => handlePdf('download')}><Download size={17} /> Baixar PDF</button>
        <button className="button commercial-quote-detail__pdf-secondary" type="button" disabled={Boolean(pdfAction)} onClick={() => handlePdf('print')}><Printer size={17} /> Imprimir</button>
        {!legacy && canEdit && quote.status === 'draft' && <button className="button button_primary commercial-quote-detail__status-action" type="button" onClick={() => setAction({ status: 'sent', title: 'Marcar como enviado', message: 'O orçamento ficará congelado. Para corrigir, será necessário reabri-lo como rascunho.', success: 'Orçamento marcado como enviado.' })}><Send size={17} /> Marcar como enviado</button>}
        {!legacy && canEdit && quote.status === 'sent' && <button className="button commercial-quote-detail__status-action" type="button" onClick={() => setAction({ status: 'draft', title: 'Reabrir rascunho', message: 'O orçamento voltará a ser editável e deixará o estado de enviado.', success: 'Orçamento reaberto como rascunho.' })}><RotateCcw size={17} /> Reabrir rascunho</button>}
        {!legacy && canApprove && quote.status === 'sent' && <button className="button button_primary commercial-quote-detail__status-action" type="button" onClick={() => setAction({ status: 'approved', title: 'Aprovar orçamento', message: 'A aprovação será somente comercial e não criará Produção, Venda, Estoque, Compra, Entrega, Expedição, tarefas ou etiquetas.', success: 'Orçamento aprovado comercialmente.' })}><CheckCircle2 size={17} /> Aprovar</button>}
        {!legacy && canEdit && quote.status === 'sent' && <button className="button button_danger commercial-quote-detail__status-action" type="button" onClick={() => setAction({ status: 'rejected', title: 'Recusar orçamento', message: 'O orçamento será preservado como recusado e não poderá ser editado.', success: 'Orçamento recusado.' })}><XCircle size={17} /> Recusar</button>}
        {!legacy && canCancel && ['draft', 'sent'].includes(quote.status) && <button className="button button_danger commercial-quote-detail__status-action" type="button" onClick={() => setAction({ status: 'cancelled', title: 'Cancelar orçamento', message: 'O orçamento será preservado no histórico como cancelado.', success: 'Orçamento cancelado.' })}><XCircle size={17} /> Cancelar</button>}
      </div>
      {legacy && <div className="panel commercial-quote-detail__legacy-notice"><strong>Histórico somente leitura</strong><span>Este registro não pode ser editado ou aprovado. O PDF disponível é reconstruído dos snapshots importados e não é um original do ERP.</span></div>}

      <div className="commercial-quote-detail__grid">
        <section className="panel commercial-quote-detail__section"><h2>Cliente no momento do orçamento</h2><dl><div><dt>Nome/razão social</dt><dd>{quote.customer_snapshot?.name || quote.customer_name_snapshot || 'Cliente não identificado'}</dd></div><div><dt>Nome fantasia</dt><dd>{quote.customer_snapshot?.trade_name || '-'}</dd></div><div><dt>CPF/CNPJ</dt><dd>{quote.customer_snapshot?.tax_id || '-'}</dd></div><div><dt>Contato</dt><dd>{quote.customer_snapshot?.phone || quote.customer_snapshot?.whatsapp || quote.customer_snapshot?.email || '-'}</dd></div><div><dt>Endereço</dt><dd>{[customerAddress.street, customerAddress.number, customerAddress.complement, customerAddress.neighborhood, customerAddress.city, customerAddress.state, customerAddress.zip_code].filter(Boolean).join(', ') || '-'}</dd></div></dl>{quote.customer_id && <Link className="button" to={`/comercial/clientes/${quote.customer_id}`}>Abrir cadastro atual do cliente</Link>}</section>
        <section className="panel commercial-quote-detail__section"><h2>Condições</h2><dl><div><dt>Data</dt><dd>{formatDate(quote.quote_date)}</dd></div><div><dt>Validade</dt><dd>{formatDate(quote.valid_until)}</dd></div><div><dt>Criado por</dt><dd>{quote.created_by_name || '-'}</dd></div><div><dt>Última atualização</dt><dd>{quote.updated_at ? new Date(quote.updated_at).toLocaleString('pt-BR') : '-'}</dd></div></dl></section>
      </div>

      <section className="panel commercial-quote-detail__section"><h2>Itens</h2><div className="commercial-quote-detail__items-table"><DataTable columns={itemsColumns} rows={quote.items} emptyText="Nenhum item." /></div><div className="commercial-quote-detail__items-mobile">{quote.items.map((item) => <article key={item.id}><div><strong>{item.product_name_snapshot}</strong><span>{[item.product_code_snapshot, item.item_type === 'manual' ? 'Manual' : null].filter(Boolean).join(' · ')}</span></div>{item.description_snapshot && <p>{item.description_snapshot}</p>}<dl><div><dt>Qtd.</dt><dd>{Number(item.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</dd></div><div><dt>Unitário</dt><dd>{formatMoney(item.unit_price)}</dd></div><div><dt>Desconto</dt><dd>{formatMoney(item.discount_amount)}</dd></div><div><dt>Total</dt><dd><strong>{formatMoney(item.subtotal)}</strong></dd></div></dl>{item.sop_minimum_price_snapshot != null && <small className={item.is_outside_sop ? 'commercial-quotes__outside-sop' : 'commercial-quotes__inside-sop'}>{item.is_outside_sop ? 'Fora da SOP' : 'Dentro da SOP'} · ref. {formatMoney(item.reference_price_snapshot)} · mín. {formatMoney(item.sop_minimum_price_snapshot)}</small>}</article>)}</div></section>

      <div className="commercial-quote-detail__grid">
        <section className="panel commercial-quote-detail__section"><h2>Pagamento</h2>{quote.payment_methods.length === 0 ? <p>Nenhuma condição informada.</p> : quote.payment_methods.map((method) => <article className="commercial-quote-detail__payment" key={method.id}><strong>{method.description}</strong><span>{PAYMENT_TYPES.find(([value]) => value === method.method_type)?.[1] || method.method_type} · {formatMoney(method.amount)} · {method.installment_count}x</span>{method.calculation_type === 'percentage' && <span>{Number(method.percentage).toLocaleString('pt-BR')}% do total</span>}<ul>{method.installments.map((installment) => <li key={installment.id}>{installment.installment_number}ª — {formatDate(installment.due_date)} — {formatMoney(installment.amount)}</li>)}</ul></article>)}</section>
        <section className="panel commercial-quote-detail__totals"><div><span>Bruto</span><strong>{formatMoney(quote.items_gross_total)}</strong></div><div><span>Descontos dos itens</span><strong>- {formatMoney(quote.items_discount_total)}</strong></div><div><span>Subtotal</span><strong>{formatMoney(quote.subtotal)}</strong></div><div><span>Desconto geral</span><strong>- {formatMoney(quote.discount_amount)}</strong></div><div><span>Frete</span><strong>{formatMoney(quote.freight_amount)}</strong></div><div className="commercial-quote-detail__total"><span>Total</span><strong>{formatMoney(quote.total)}</strong></div></section>
      </div>

      {(quote.notes || quote.internal_notes) && <section className="panel commercial-quote-detail__section"><h2>Observações</h2>{quote.notes && <><h3>Comerciais</h3><p className="commercial-quote-detail__preline">{quote.notes}</p></>}{quote.internal_notes && <><h3>Internas</h3><p className="commercial-quote-detail__preline">{quote.internal_notes}</p></>}</section>}
      {!legacy && quote.documents?.[0] && <p className="commercial-quote-detail__document-meta">PDF oficial v{quote.documents[0].document_version} · SHA-256 {quote.documents[0].sha256}</p>}
      {legacy && quote.documents?.find((document) => document.provenance_classification === 'RECONSTRUCTED') && <p className="commercial-quote-detail__document-meta">PDF histórico reconstruído · SHA-256 {quote.documents.find((document) => document.provenance_classification === 'RECONSTRUCTED').sha256}</p>}
      {legacy && <section className="panel commercial-quote-detail__section"><h2>Rastreabilidade</h2><dl><div><dt>Origem</dt><dd>ERP Universal</dd></div><div><dt>Número original</dt><dd>#{quote.source_legacy_number}</dd></div>{quote.aliases?.length > 1 && <div><dt>Duplicados integrais descartados</dt><dd>{quote.aliases.filter((item) => !item.is_primary).map((item) => `ERP #${item.source_legacy_number}`).join(', ')}</dd></div>}<div><dt>Total</dt><dd>Reconstruído das linhas pela fórmula ERP_UNIVERSAL_V1</dd></div></dl></section>}
      {!legacy && <section className="panel commercial-quote-detail__section"><h2>Histórico</h2><ol className="commercial-quote-detail__history">{quote.history.map((event) => <li key={event.id}><div><strong>{historyLabels[event.action] || event.action}</strong><span>{event.user_name || 'Sistema'}</span></div><time>{new Date(event.created_at).toLocaleString('pt-BR')}</time></li>)}</ol></section>}

      <ConfirmModal open={Boolean(action)} title={action?.title || ''} onCancel={() => setAction(null)} actions={<button className={`button ${action?.status === 'sent' || action?.status === 'approved' ? 'button_primary' : 'button_danger'}`} type="button" disabled={saving} onClick={changeStatus}>{saving ? 'Salvando...' : 'Confirmar'}</button>}><p>{action?.message}</p></ConfirmModal>
    </section>
  );
}
