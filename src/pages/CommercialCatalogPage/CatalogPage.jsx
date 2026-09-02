import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Search } from 'lucide-react';
import { api, apiErrorMessage, getStoredUser } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './CommercialCatalog.css';
import { CatalogImage } from './CatalogImage.jsx';

const money = (value) => value == null ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function CatalogPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [configured, setConfigured] = useState('');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/commercial/catalog', { params: { search, configured: configured || undefined, status, limit: 100 } });
      if (!Array.isArray(response.data?.items)) {
        throw new Error('Resposta inválida do servidor ao carregar o Catálogo.');
      }
      setItems(response.data.items);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, 'Não foi possível carregar o Catálogo.');
      setError(message);
      toast.error(message);
    }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <section className="page commercial-catalog">
    <header className="page__header"><div><h1 className="page__title">Produtos comerciais / Catálogo</h1><p>Produtos apresentados ao Cliente, independentes do cadastro operacional.</p></div>{canAccessPermission(getStoredUser(), 'commercial.catalog.create') && <Link className="button button_primary" to="/comercial/catalogo/novo"><Plus size={17} /> Novo produto comercial</Link>}</header>
    <div className="panel">
      <form className="commercial-catalog__filters" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="field"><span className="field__label">Buscar Produto Comercial</span><input className="field__input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou código comercial" /></label>
        <label className="field"><span className="field__label">Catálogo Técnico</span><select className="field__input" value={configured} onChange={(event) => setConfigured(event.target.value)}><option value="">Todos</option><option value="yes">Configurado</option><option value="no">Não configurado</option></select></label>
        <label className="field"><span className="field__label">Status</span><select className="field__input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option></select></label>
        <button className="button button_primary" type="submit"><Search size={17} /> Buscar</button>
      </form>
      {loading && <p>Carregando...</p>}
      {!loading && error && <div className="commercial-catalog__feedback commercial-catalog__feedback_error"><p>{error}</p><button className="button" type="button" onClick={load}>Tentar novamente</button></div>}
      {!loading && !error && <div className="commercial-catalog__grid">
        {items.map((item) => <article className="commercial-catalog__card" key={item.commercial_product_id}>
          <div className="commercial-catalog__photo">{item.commercial_image_id ? <CatalogImage imageId={item.commercial_image_id} alt={item.product_name} /> : <><BookOpen size={34} /><span>{item.has_operational_photo ? 'Foto operacional disponível' : 'Sem foto'}</span></>}</div>
          <div className="commercial-catalog__card-body"><small>{item.commercial_code || 'Sem código comercial'}{item.source_system === 'ERP_UNIVERSAL' ? ' · Origem: ERP Universal' : ''}</small><h2>{item.product_name}</h2><span className={`commercial-catalog__badge ${item.catalog_configured ? 'is-configured' : ''}`}>{item.catalog_configured ? 'Catálogo configurado' : 'Sem Catálogo Técnico'}</span>
            <dl><div><dt>Preço de referência</dt><dd>{money(item.reference_price)}</dd></div><div><dt>SOP</dt><dd>{item.sop_discount_type === 'percentage' ? `${item.sop_discount_value}%` : item.sop_discount_value != null ? money(item.sop_discount_value) : 'Não configurada'}</dd></div><div><dt>Versão ativa</dt><dd>{item.active_version_number ? `v${item.active_version_number}` : 'Nenhuma'}</dd></div><div><dt>Produto interno</dt><dd>{item.operational_product_name || 'Não vinculado'}</dd></div><div><dt>Status</dt><dd>{item.is_active ? 'Ativo' : 'Inativo'}</dd></div></dl>
          </div>
          <Link className="button button_primary" to={`/comercial/catalogo/${item.commercial_product_id}`}>Abrir ficha comercial</Link>
        </article>)}
        {!items.length && <p>Nenhum Produto Comercial encontrado.</p>}
      </div>}
    </div>
  </section>;
}
