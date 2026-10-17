import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Search } from 'lucide-react';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api } from '../../services/api.js';
import { formatDate, formatMoney } from '../CommercialQuotesPage/quoteUi.js';
import './CommercialSales.css';

export function SalesPage() {
  const toast = useToast();
  const [sales, setSales] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(term = search) {
    try {
      setLoading(true);
      setError('');
      setSales((await api.get('/commercial/sales', { params: { search: term } })).data);
    } catch (error) {
      const message = error.response?.data?.message || 'Não foi possível carregar as vendas.';
      setError(message);
      toast.error(message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    { key: 'sale', label: 'Venda', render: (row) => <Link to={`/comercial/vendas/${row.id}`}><strong>Venda #{row.sale_number}</strong></Link> },
    { key: 'customer', label: 'Cliente', render: (row) => row.customer_name_snapshot },
    { key: 'quote', label: 'Origem', render: (row) => <Link to={`/comercial/orcamentos/${row.commercial_quote_id}`}>Orçamento #{row.commercial_number}</Link> },
    { key: 'date', label: 'Data', render: (row) => formatDate(row.created_at) },
    { key: 'items', label: 'Produção', render: (row) => `${row.production_item_count}/${row.item_count} item(ns)` },
    { key: 'status', label: 'Status', render: () => 'Confirmada' },
    { key: 'total', label: 'Total', render: (row) => <strong>{formatMoney(row.total)}</strong> },
  ];

  return (
    <section className="page commercial-sales">
      <header className="page__header"><div><h1 className="page__title">Vendas</h1><p>Vendas confirmadas a partir de Orçamentos aprovados.</p></div></header>
      <form className="panel commercial-sales__filters" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="field__label">Pesquisar</span><input className="field__input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Venda, orçamento ou cliente" /></label>
        <button className="button" type="submit"><Search size={17} /> Buscar</button>
      </form>
      <section className="panel commercial-sales__list">
        {loading && <p>Carregando vendas...</p>}
        {!loading && error && <div className="commercial-sales__error"><p>{error}</p><button className="button" type="button" onClick={() => load()}>Tentar novamente</button></div>}
        {!loading && !error && <>
          <DataTable columns={columns} rows={sales} emptyText="Nenhuma venda encontrada." />
          <div className="commercial-sales__cards">
            {sales.map((sale) => <article className="commercial-sales__card" key={sale.id}>
              <header><strong>Venda #{sale.sale_number}</strong><span>Confirmada</span></header>
              <p>{sale.customer_name_snapshot || 'Cliente não identificado'}</p>
              <dl>
                <div><dt>Origem</dt><dd>Orçamento #{sale.commercial_number}</dd></div>
                <div><dt>Data</dt><dd>{formatDate(sale.created_at)}</dd></div>
                <div><dt>Produção</dt><dd>{sale.production_item_count}/{sale.item_count} item(ns)</dd></div>
                <div><dt>Total</dt><dd><strong>{formatMoney(sale.total)}</strong></dd></div>
              </dl>
              <Link className="button button_primary" to={`/comercial/vendas/${sale.id}`}><Eye size={16} /> Abrir venda</Link>
            </article>)}
            {sales.length === 0 && <p>Nenhuma venda encontrada.</p>}
          </div>
        </>}
      </section>
    </section>
  );
}
