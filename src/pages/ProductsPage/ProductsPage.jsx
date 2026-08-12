import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { ProductPhotoEditor } from '../../components/ProductPhotoEditor/ProductPhotoEditor.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './ProductsPage.css';

const PAGE_LIMIT = 20;
const emptyFilters = { review_status: '', product_type: '', sector_id: '' };

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR');
}

export function ProductsPage() {
  const user = getStoredUser();
  const toast = useToast();
  const canCreate = canAccessPermission(user, 'products.create');
  const canEdit = canAccessPermission(user, 'products.edit');
  const canDelete = canAccessPermission(user, 'products.delete');
  const canManageTypes = canAccessPermission(user, 'products.types.manage');
  const [products, setProducts] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_LIMIT, total: 0, total_pages: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [productToDelete, setProductToDelete] = useState(null);
  const [photoProduct, setPhotoProduct] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/products/types'),
      api.get('/sectors'),
    ]).then(([typesResponse, sectorsResponse]) => {
      if (!active) return;
      setProductTypes(typesResponse.data.filter((type) => type.is_active));
      setSectors(sectorsResponse.data.filter((sector) => sector.is_active !== false));
    }).catch(() => {
      if (active) toast.error('Não foi possível carregar os filtros de Produtos.');
    });
    return () => { active = false; };
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setError('');

    api.get('/products', {
      params: {
        paginated: true,
        page,
        limit: PAGE_LIMIT,
        search: search || undefined,
        review_status: filters.review_status || undefined,
        product_type: filters.product_type || undefined,
        sector_id: filters.sector_id || undefined,
      },
      signal: controller.signal,
    }).then((response) => {
      if (!active) return;
      setProducts(response.data.items);
      setPagination(response.data);
    }).catch((requestError) => {
      if (!active || requestError.code === 'ERR_CANCELED') return;
      setError(requestError.response?.data?.message || 'Não foi possível carregar os Produtos.');
    }).finally(() => {
      if (active) setIsLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, page, reloadKey, search]);

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function changeFilter(event) {
    const { name, value } = event.target;
    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setFilters(emptyFilters);
    setPage(1);
  }

  async function deleteProduct() {
    if (!productToDelete) return;
    try {
      setIsDeleting(true);
      await api.delete(`/products/${productToDelete.id}`);
      setProductToDelete(null);
      if (products.length === 1 && page > 1) setPage((current) => current - 1);
      else setReloadKey((current) => current + 1);
      toast.success('Produto excluído.');
    } catch (deleteError) {
      toast.error(deleteError.response?.data?.message || 'Não foi possível excluir o Produto.');
    } finally {
      setIsDeleting(false);
    }
  }

  const hasFilters = Boolean(search || filters.review_status || filters.product_type || filters.sector_id);
  const firstResult = pagination.total ? ((pagination.page - 1) * pagination.limit) + 1 : 0;
  const lastResult = Math.min(pagination.page * pagination.limit, pagination.total);
  const hasActions = canEdit || canDelete;
  const columns = [
    {
      key: 'name',
      label: 'Produto',
      mobileLabel: 'Produto',
      className: 'products-page__product-column',
      render: (row) => (
        <div className="products-page__product-name">
          {canEdit ? <Link to={`/produtos/${row.id}`}>{row.name}</Link> : <span>{row.name}</span>}
          {row.internal_code && <small>Código: {row.internal_code}</small>}
          {row.review_status === 'pending_review' && <span className="products-page__review-badge">Pendente de revisão</span>}
        </div>
      ),
    },
    { key: 'type', label: 'Tipo', render: (row) => row.type_name || row.product_type?.name || row.type || '—' },
    { key: 'sector_name', label: 'Setor responsável', render: (row) => row.sector_name || '—' },
    { key: 'default_volume_quantity', label: 'Volumes', className: 'products-page__secondary-column' },
    { key: 'default_total_weight_kg', label: 'Peso total', className: 'products-page__secondary-column', render: (row) => `${row.default_total_weight_kg} kg` },
    { key: 'measurement_unit_code', label: 'Unidade', render: (row) => row.measurement_unit_code || 'Legada — não definida' },
    {
      key: 'review_status',
      label: 'Revisão',
      render: (row) => row.review_status === 'pending_review' ? 'Pendente' : 'Revisado',
    },
    { key: 'creation_origin', label: 'Origem', render: (row) => row.creation_origin === 'purchases' ? 'Compras' : 'Cadastro regular' },
    {
      key: 'has_photo',
      label: 'Foto',
      render: (row) => row.has_photo
        ? <button className="button products-page__photo-button" type="button" onClick={() => setPhotoProduct(row)}>Ver foto</button>
        : '—',
    },
    { key: 'preliminary_created_by_name', label: 'Criado por', render: (row) => row.preliminary_created_by_name || '—' },
    { key: 'created_at', label: 'Criado em', render: (row) => formatDate(row.preliminary_created_at || row.created_at) },
    ...(hasActions ? [{
      key: 'actions',
      label: 'Ações',
      className: 'products-page__actions-column',
      render: (row) => (
        <div className="products-page__row-actions">
          {canEdit && <Link className="button" to={`/produtos/${row.id}`}>Editar</Link>}
          {canDelete && (
            <button className="button button_danger" type="button" onClick={() => setProductToDelete(row)}>
              Excluir
            </button>
          )}
        </div>
      ),
    }] : []),
  ];

  return (
    <section className="page products-page">
      <div className="page__header">
        <h1 className="page__title">Produtos</h1>
        <div className="page__actions">
          {canManageTypes && <Link className="button" to="/produtos/tipos">Tipos de produto</Link>}
          {canCreate && <Link className="button button_primary" to="/produtos/novo">Novo produto</Link>}
        </div>
      </div>

      <div className="panel">
        <form className="products-page__filters" onSubmit={submitSearch}>
          <label className="field products-page__search-field">
            <span className="field__label">Buscar Produto</span>
            <input
              className="field__input"
              name="search"
              type="search"
              value={searchInput}
              placeholder="Nome ou código interno"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Revisão</span>
            <select className="field__input" name="review_status" value={filters.review_status} onChange={changeFilter}>
              <option value="">Todos</option>
              <option value="pending_review">Pendentes</option>
              <option value="approved">Revisados</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Tipo</span>
            <select className="field__input" name="product_type" value={filters.product_type} onChange={changeFilter}>
              <option value="">Todos os tipos</option>
              {productTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Setor responsável</span>
            <select className="field__input" name="sector_id" value={filters.sector_id} onChange={changeFilter}>
              <option value="">Todos os setores</option>
              <option value="without-sector">Sem setor responsável</option>
              {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
            </select>
          </label>
          <div className="products-page__filter-actions">
            <button className="button button_primary" type="submit">Buscar</button>
            <button className="button products-page__clear-button" type="button" onClick={clearFilters}>Limpar</button>
          </div>
        </form>

        <div className="products-page__list-header">
          <div>
            <h2>{hasFilters ? 'Resultados da busca' : 'Produtos recentes'}</h2>
            {!error && (
              <p>
                {pagination.total === 0
                  ? 'Nenhum resultado'
                  : `Exibindo ${firstResult}–${lastResult} de ${pagination.total} Produtos`}
              </p>
            )}
          </div>
          {isLoading && <span className="products-page__loading" role="status">Carregando…</span>}
        </div>

        {error && (
          <div className="products-page__error" role="alert">
            <p>{error}</p>
            <button className="button" type="button" onClick={() => setReloadKey((current) => current + 1)}>Tentar novamente</button>
          </div>
        )}

        {!error && (!isLoading || products.length > 0) && (
          <DataTable
            columns={columns}
            rows={products}
            emptyText={hasFilters ? 'Nenhum Produto encontrado para os filtros informados.' : 'Sem Produtos cadastrados.'}
          />
        )}

        {!error && pagination.total_pages > 1 && (
          <nav className="products-page__pagination" aria-label="Paginação de Produtos">
            <button className="button" type="button" disabled={isLoading || page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button>
            <span>Página {pagination.page} de {pagination.total_pages}</span>
            <button className="button" type="button" disabled={isLoading || page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)}>Próxima</button>
          </nav>
        )}
      </div>

      <ConfirmModal open={Boolean(photoProduct)} title="Foto do Produto" onCancel={() => setPhotoProduct(null)}>
        {photoProduct && (
          <ProductPhotoEditor
            product={photoProduct}
            onPhotoChange={(hasPhoto) => {
              setPhotoProduct((current) => current ? { ...current, has_photo: hasPhoto } : current);
              setProducts((current) => current.map((item) => item.id === photoProduct.id ? { ...item, has_photo: hasPhoto } : item));
            }}
          />
        )}
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(productToDelete)}
        title="Excluir Produto"
        onCancel={() => setProductToDelete(null)}
        actions={(
          <button className="button button_danger" type="button" onClick={deleteProduct} disabled={isDeleting}>
            {isDeleting ? 'Excluindo...' : 'Excluir'}
          </button>
        )}
      >
        Deseja excluir o Produto {productToDelete?.name}? Ele sairá das listagens operacionais, mas os registros antigos serão preservados.
      </ConfirmModal>
    </section>
  );
}
