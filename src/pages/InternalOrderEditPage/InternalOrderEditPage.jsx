import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InternalOrderForm } from '../../components/InternalOrderForm/InternalOrderForm.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';

export function InternalOrderEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [order, setOrder] = useState(null);

  useEffect(() => {
    api.get(`/internal-orders/${id}`).then((response) => setOrder(response.data));
  }, [id]);

  async function submit(payload) {
    try {
      await api.put(`/internal-orders/${id}`, payload);
      toast.success('Ordem de produção atualizada.');
      navigate(`/os/${id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar a ordem de produção.');
    }
  }

  if (!order) return <div className="panel">Carregando...</div>;

  return (
    <section className="page internal-order-create-page">
      <div className="page__header">
        <h1 className="page__title">Editar ordem de produção {order.sale_number}</h1>
      </div>
      <InternalOrderForm initialOrder={order} onSubmit={submit} submitLabel="Salvar ordem de produção" />
    </section>
  );
}
