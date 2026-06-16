import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './ProductsPage.css';

export function ProductsPage() {
  const user = getStoredUser();
  const toast = useToast();
  const canManage = ['admin', 'manager'].includes(user?.role);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [productToDelete, setProductToDelete] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadProducts() {
      try {
        setError('');
        const response = await api.get('/products');
        if (active) setProducts(response.data);
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

  const columns = [
    { key: 'name', label: 'Nome', render: (row) => <Link to={`/produtos/${row.id}`}>{row.name}</Link> },
    { key: 'type', label: 'Tipo', render: (row) => <StatusBadge value={row.type} /> },
    { key: 'sector_name', label: 'Setor responsável', render: (row) => row.sector_name || '-' },
    { key: 'default_volume_quantity', label: 'Volumes' },
    { key: 'default_total_weight_kg', label: 'Peso total (kg)' },
    ...(canManage ? [{
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
          <Link className="button" to="/produtos/tipos">Tipos de produto</Link>
          <Link className="button button_primary" to="/produtos/novo">Novo produto</Link>
        </div>
      </div>
      <div className="panel">
        {isLoading && <p>Carregando produtos...</p>}
        {error && <p>{error}</p>}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            rows={products}
          />
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
