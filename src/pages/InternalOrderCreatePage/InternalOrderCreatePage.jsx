import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { InternalOrderForm } from '../../components/InternalOrderForm/InternalOrderForm.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './InternalOrderCreatePage.css';

export function InternalOrderCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pendingPayload, setPendingPayload] = useState(null);
  const [readyModalOpen, setReadyModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function submit(payload) {
    setPendingPayload(payload);
    setReadyModalOpen(true);
  }

  function closeReadyModal() {
    if (isSaving) return;
    setReadyModalOpen(false);
    setPendingPayload(null);
  }

  async function createOrder(goodsReady) {
    if (!pendingPayload || !readyModalOpen || isSaving) return;
    setIsSaving(true);
    try {
      const response = await api.post('/internal-orders', { ...pendingPayload, goods_ready: goodsReady });
      toast.success(goodsReady ? 'OS criada e liberada para etiquetas.' : 'Ordem de Serviço criada com sucesso.');
      setReadyModalOpen(false);
      setPendingPayload(null);
      navigate(goodsReady ? '/fila-etiquetas' : `/os/${response.data.id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível criar a Ordem de Serviço.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page internal-order-create-page">
      <div className="page__header">
        <h1 className="page__title">Nova Ordem de Serviço Interna</h1>
      </div>
      <InternalOrderForm onSubmit={submit} isSubmitting={isSaving} />
      <ConfirmModal
        open={readyModalOpen}
        title="Serviço já finalizado?"
        onCancel={closeReadyModal}
        actions={(
          <>
            <button className="button" type="button" onClick={() => createOrder(false)} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Não, enviar para produção'}
            </button>
            <button className="button button_primary" type="button" onClick={() => createOrder(true)} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Sim, liberar etiquetas'}
            </button>
          </>
        )}
      >
        <p>Esta OS já deve ser liberada diretamente para a Fila de Etiquetas?</p>
      </ConfirmModal>
    </section>
  );
}
