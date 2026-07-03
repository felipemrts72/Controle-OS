import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './ProductsPage.css';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [productToDelete, setProductToDelete] = useState(null);
  const [filters, setFilters] = useState({ search: '', type: '', sector: '' });
  const [sort, setSort] = useState({ key: '', direction: 'asc' });

  useEffect(() => {
    let active = true;
    async function loadProducts() {
      try {
        setError('');
        const [productsResponse, productTypesResponse, sectorsResponse] = await Promise.all([
          api.get('/products'),
          api.get('/products/types'),
          api.get('/sectors').catch(() => ({ data: [] })),
        ]);
        if (active) {
          setProducts(productsResponse.data);
          setProductTypes(productTypesResponse.data);
          setSectors(sectorsResponse.data);
        }
      } catch {
        if (active) {
          const message = 'Não foi possível carregar os produtos. Verifique se o backend e o banco estão atualizados.';
          setError(message);
          toast.error(message);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadProducts();
    return () => {
      active = false;
    };
  }, [toast]);

  async function reloadProducts() {
    const response = await api.get('/products');
    setProducts(response.data);
  }

  async function deleteProduct() {
    if (!productToDelete) return;
    try {
      setIsDeleting(true);
      await api.delete(`/products/${productToDelete.id}`);
      setProductToDelete(null);
      await reloadProducts();
      toast.success('Produto excluído.');
    } catch (deleteError) {
      toast.error(deleteError.response?.data?.message || 'Não foi possível excluir o produto.');
    } finally {
      setIsDeleting(false);
    }
  }

  function changeFilter(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setFilters({ search: '', type: '', sector: '' });
  }

  function toggleSort(key) {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    ));
  }

  function sortButton(key, label) {
    const isActive = sort.key === key;

    return (
      <button className="products-page__sort-button" type="button" onClick={() => toggleSort(key)}>
        <span>{label}</span>
        <span className="products-page__sort-arrow" aria-hidden="true">
          {isActive ? (sort.direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    );
  }

  const filteredProducts = useMemo(() => {
    const search = filters.search.trim().toLocaleLowerCase('pt-BR');

    const filtered = [...products]
      .filter((product) => {
        const productName = String(product.name || '').toLocaleLowerCase('pt-BR');
        const matchesSearch = !search || productName.includes(search);
        const matchesType = !filters.type || product.type === filters.type;
        const matchesSector = !filters.sector
          || (filters.sector === 'without-sector' ? !product.sector_id : String(product.sector_id) === filters.sector);

        return matchesSearch && matchesType && matchesSector;
      });

    if (!sort.key) return filtered;

    return filtered.sort((first, second) => {
      if (sort.key === 'sector_name') {
        const firstHasSector = Boolean(first.sector_name);
        const secondHasSector = Boolean(second.sector_name);
        if (!firstHasSector && secondHasSector) return 1;
        if (firstHasSector && !secondHasSector) return -1;
      }

      const firstValue = sort.key === 'type'
        ? first.type_name || first.product_type?.name || first.type || ''
        : first[sort.key] || '';
      const secondValue = sort.key === 'type'
        ? second.type_name || second.product_type?.name || second.type || ''
        : second[sort.key] || '';
      const result = String(firstValue).localeCompare(String(secondValue), 'pt-BR');

      return sort.direction === 'asc' ? result : -result;
    });
  }, [filters, products, sort]);

  const columns = [
    { key: 'name', label: sortButton('name', 'Nome'), render: (row) => canEdit ? <Link to={`/produtos/${row.id}`}>{row.name}</Link> : row.name },
    { key: 'type', label: sortButton('type', 'Tipo'), render: (row) => <StatusBadge value={row.type} /> },
    { key: 'sector_name', label: sortButton('sector_name', 'Setor responsável'), render: (row) => row.sector_name || '-' },
    { key: 'default_volume_quantity', label: 'Volumes' },
    { key: 'default_total_weight_kg', label: 'Peso total (kg)' },
    ...(canDelete ? [{
      key: 'actions',
      label: 'Ações',
      render: (row) => (
        <div className="products-page__row-actions">
          <button className="button button_danger" type="button" onClick={() => setProductToDelete(row)}>
            Excluir
          </button>
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
        {isLoading && <p>Carregando produtos...</p>}
        {error && <p>{error}</p>}
        {!isLoading && !error && (
          <>
            <div className="products-page__filters">
              <label className="field">
                <span className="field__label">Buscar por nome</span>
                <input
                  className="field__input"
                  name="search"
                  type="search"
                  value={filters.search}
                  onChange={changeFilter}
                />
              </label>
              <label className="field">
                <span className="field__label">Tipo do produto</span>
                <select className="field__input" name="type" value={filters.type} onChange={changeFilter}>
                  <option value="">Todos os tipos</option>
                  {productTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Setor responsável</span>
                <select className="field__input" name="sector" value={filters.sector} onChange={changeFilter}>
                  <option value="">Todos os setores</option>
                  <option value="without-sector">Sem setor responsável</option>
                  {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                </select>
              </label>
              <button className="button products-page__clear-button" type="button" onClick={clearFilters}>
                Limpar filtros
              </button>
            </div>
            <DataTable
              columns={columns}
              rows={filteredProducts}
              emptyText="Nenhum produto encontrado com os filtros selecionados."
            />
          </>
        )}
      </div>
      <ConfirmModal
        open={Boolean(productToDelete)}
        title="Excluir produto"
        onCancel={() => setProductToDelete(null)}
        actions={(
          <button className="button button_danger" type="button" onClick={deleteProduct} disabled={isDeleting}>
            {isDeleting ? 'Excluindo...' : 'Excluir'}
          </button>
        )}
      >
        Deseja excluir o produto {productToDelete?.name}? Ele sairá das listagens operacionais, mas os registros antigos serão preservados.
      </ConfirmModal>
    </section>
  );
}
