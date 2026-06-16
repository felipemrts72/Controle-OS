import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProductForm } from '../../components/ProductForm/ProductForm.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import './ProductFormPage.css';

export function ProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [product, setProduct] = useState(null);
  const goBack = useCallback(() => navigate('/produtos'), [navigate]);

  useEscapeKey(true, goBack);

  useEffect(() => {
    if (id) api.get(`/products/${id}`).then((response) => setProduct(response.data));
  }, [id]);

  async function submit(payload) {
    try {
      if (id) {
        await api.put(`/products/${id}`, payload);
        toast.success('Produto atualizado com sucesso.');
      } else {
        await api.post('/products', payload);
        toast.success('Produto criado com sucesso.');
      }
      navigate('/produtos');
    } catch (error) {
      toast.error(error.response?.data?.message || (id ? 'Não foi possível atualizar o produto.' : 'Não foi possível criar o produto.'));
    }
  }

  if (id && !product) return <div className="panel">Carregando...</div>;

  return (
    <section className="page product-form-page">
      <div className="product-form-page__top-actions">
        <Link className="button" to="/produtos">Voltar</Link>
      </div>
      <div className="page__header">
        <h1 className="page__title">{id ? 'Editar produto' : 'Novo produto'}</h1>
      </div>
      <ProductForm initialProduct={product || undefined} onSubmit={submit} />
    </section>
  );
}
