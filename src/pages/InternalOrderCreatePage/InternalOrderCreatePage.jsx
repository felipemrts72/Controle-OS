import { useNavigate } from 'react-router-dom';
import { InternalOrderForm } from '../../components/InternalOrderForm/InternalOrderForm.jsx';
import { api } from '../../services/api.js';
import './InternalOrderCreatePage.css';

export function InternalOrderCreatePage() {
  const navigate = useNavigate();

  async function submit(payload) {
    const response = await api.post('/internal-orders', payload);
    navigate(`/os/${response.data.id}`);
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
