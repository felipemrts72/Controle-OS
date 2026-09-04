import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { formatDate, formatMoney, PAYMENT_TYPES } from '../CommercialQuotesPage/quoteUi.js';
import './CommercialSales.css';

const productionTone = {
  created: 'success', pending_review: 'warning', incomplete_configuration: 'warning',
  resale: 'neutral', material_prima: 'neutral', no_operational_product: 'neutral',
  inactive_product: 'danger', invalid_quantity: 'danger',
};

export function SaleDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const canViewOrders = canAccessPermission(getStoredUser(), 'orders.view');

  useEffect(() => {
    (async () => {
      try { setSale((await api.get(`/commercial/sales/${id}`)).data); }
      catch (error) { toast.error(error.response?.data?.message || 'Não foi possível carregar a venda.'); }
      finally { setLoading(false); }
    })();
  }, [id, toast]);

  if (loading) return <section className="page"><div className="panel">Carregando venda...</div></section>;
  if (!sale) return <section className="page"><div className="panel">Venda não encontrada.</div></section>;
  const pending = sale.items.filter((item) => item.production_status !== 'created');
  const columns = [
    { key: 'line', label: '#', render: (row) => row.line_order },
    { key: 'item', label: 'Item', render: (row) => <div className="commercial-sales__item"><strong>{row.product_name_snapshot}</strong><span>{row.description_snapshot || '-'}</span></div> },
    { key: 'quantity', label: 'Qtd.', render: (row) => Number(row.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) },
    { key: 'unit', label: 'Unitário', render: (row) => formatMoney(row.unit_price) },
    { key: 'discount', label: 'Desc. / un.', render: (row) => formatMoney(row.unit_discount_amount) },
    { key: 'total', label: 'Total', render: (row) => formatMoney(row.subtotal) },
    { key: 'production', label: 'Produção', render: (row) => <span className={`commercial-sales__production commercial-sales__production_${productionTone[row.production_status] || 'neutral'}`}>{row.production_reason}</span> },
  ];

  return (
    <section className="page commercial-sales">
      <header className="page__header"><div><h1 className="page__title">Venda #{sale.sale_number}</h1><p>Origem: Orçamento #{sale.commercial_number} · {sale.customer_name_snapshot}</p></div><div className="page__actions"><Link className="button" to="/comercial/vendas"><ArrowLeft size={17} /> Vendas</Link><Link className="button" to={`/comercial/orcamentos/${sale.commercial_quote_id}`}>Abrir orçamento</Link>{canViewOrders && sale.production_order_id && <Link className="button button_primary" to={`/os/${sale.production_order_id}`}><ClipboardList size={17} /> Abrir Produção</Link>}</div></header>
      <section className="panel commercial-sales__summary"><div><span>Data</span><strong>{formatDate(sale.created_at)}</strong></div><div><span>Status</span><strong>Confirmada</strong></div><div><span>Itens</span><strong>{sale.item_count}</strong></div><div><span>Enviados à Produção</span><strong>{sale.production_item_count}</strong></div><div><span>Total</span><strong>{formatMoney(sale.total)}</strong></div></section>
      {pending.length > 0 && <section className="panel commercial-sales__notice"><strong>{pending.length} item(ns) sem envio à Produção</strong><ul>{pending.map((item) => <li key={item.id}>{item.product_name_snapshot}: {item.production_reason}</li>)}</ul></section>}
      <section className="panel"><h2>Itens da Venda</h2><DataTable columns={columns} rows={sale.items} emptyText="Nenhum item." /></section>
      <div className="commercial-sales__grid"><section className="panel"><h2>Pagamento</h2>{sale.payment_methods_snapshot.length ? sale.payment_methods_snapshot.map((method) => <p key={method.id}><strong>{method.description}</strong><br />{PAYMENT_TYPES.find(([value]) => value === method.method_type)?.[1] || method.method_type} · {formatMoney(method.amount)} · {method.installment_count}x</p>) : <p>Nenhuma condição.</p>}</section><section className="panel commercial-sales__totals"><div><span>Subtotal</span><strong>{formatMoney(sale.subtotal)}</strong></div><div><span>Desconto geral</span><strong>- {formatMoney(sale.discount_amount)}</strong></div><div><span>Frete</span><strong>{formatMoney(sale.freight_amount)}</strong></div><div><span>Total</span><strong>{formatMoney(sale.total)}</strong></div></section></div>
    </section>
  );
}
