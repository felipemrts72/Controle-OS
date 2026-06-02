import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProductForm } from '../../components/ProductForm/ProductForm.jsx';
import { api } from '../../services/api.js';
import './ProductFormPage.css';

export function ProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);

  useEffect(() => {
    if (id) api.get(`/products/${id}`).then((response) => setProduct(response.data));
  }, [id]);

  async function submit(payload) {
    if (id) await api.put(`/products/${id}`, payload);
    else await api.post('/products', payload);
    navigate('/produtos');
  }

  if (id && !product) return <div className="panel">Carregando...</div>;

  return (
    <section className="page product-form-page">
      <div className="page__header">
        <h1 className="page__title">{id ? 'Editar produto' : 'Novo produto'}</h1>
      </div>
      <ProductForm initialProduct={product || undefined} onSubmit={submit} />
    </section>
  );
}
