import { useNavigate } from 'react-router-dom';
import { InternalOrderForm } from '../../components/InternalOrderForm/InternalOrderForm.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './InternalOrderCreatePage.css';

export function InternalOrderCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();

  async function submit(payload) {
    try {
      const response = await api.post('/internal-orders', payload);
      toast.success('Ordem de Serviço criada com sucesso.');
      navigate(`/os/${response.data.id}`);
    } catch {
      toast.error('Não foi possível criar a Ordem de Serviço.');
    }
  }

  return (
    <section className="page internal-order-create-page">
      <div className="page__header">
        <h1 className="page__title">Nova Ordem de Serviço Interna</h1>
      </div>
      <InternalOrderForm onSubmit={submit} />
    </section>
  );
}
