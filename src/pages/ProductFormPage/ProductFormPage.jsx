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

  async function submit(payload, pendingPhoto) {
    try {
      if (id) {
        await api.put(`/products/${id}`, payload);
        toast.success('Produto atualizado com sucesso.');
      } else if (payload.id && payload.photo_upload_token) {
        toast.success('Produto criado com sucesso.');
      } else {
        const response = await api.post('/products', payload);
        const createdProduct = { ...response.data, has_photo: false };
        if (pendingPhoto) {
          try {
            await api.put(`/products/${createdProduct.id}/photo`, await pendingPhoto.arrayBuffer(), {
              headers: {
                'Content-Type': pendingPhoto.type,
                'X-File-Name': encodeURIComponent(pendingPhoto.name),
                'X-Product-Create-Token': createdProduct.photo_upload_token,
              },
            });
            createdProduct.has_photo = true;
          } catch (photoError) {
            setProduct(createdProduct);
            toast.warning(`Produto criado, mas a foto não foi enviada: ${photoError.response?.data?.message || 'falha no upload'}. Tente enviar novamente.`);
            return { product: createdProduct, photoUploadFailed: true };
          }
        }
        toast.success('Produto criado com sucesso.');
      }
      navigate('/produtos');
      return { product: null, photoUploadFailed: false };
    } catch (error) {
      toast.error(error.response?.data?.message || (id ? 'Não foi possível atualizar o produto.' : 'Não foi possível criar o produto.'));
      return null;
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
      <ProductForm
        initialProduct={product || undefined}
        onSubmit={submit}
        onPhotoUploaded={() => navigate('/produtos')}
      />
    </section>
  );
}
