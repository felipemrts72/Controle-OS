import { ConfirmModal } from '../ConfirmModal/ConfirmModal.jsx';
import './LabelGenerationModal.css';

export function LabelGenerationModal({
  open,
  details,
  invoiceNumber,
  onInvoiceChange,
  onCancel,
  onConfirm,
  onRetryDownload,
  busy = false,
  downloadFailed = false,
}) {
  if (!open || !details) return null;
  const destination = [details.destination_city, details.destination_uf].filter(Boolean).join('/') || 'Não informado';
  const destinationRequired = ['transportadora', 'frota_propria'].includes(details.delivery_type || 'transportadora');
  const destinationMissing = destinationRequired && (!details.destination_city || !details.destination_uf);

  return (
    <ConfirmModal
      open
      title={downloadFailed ? 'Etiquetas geradas' : 'Gerar etiquetas'}
      onCancel={onCancel}
      showCancel={false}
      contentClassName="label-generation-modal"
      actions={(
        <>
          <button className="button" type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
          {downloadFailed ? (
            <button className="button button_primary" type="button" onClick={onRetryDownload} disabled={busy}>Baixar novamente</button>
          ) : (
            <button className="button button_primary" type="button" onClick={onConfirm} disabled={busy || destinationMissing}>
              {busy ? 'Gerando...' : 'Confirmar geração'}
            </button>
          )}
        </>
      )}
    >
      <div className="label-generation-modal__summary">
        <p><strong>Venda:</strong> {details.sale_number || '-'}</p>
        <p><strong>Cliente:</strong> {details.customer_name || '-'}</p>
        <p><strong>Produto:</strong> {details.product_name || '-'}</p>
        <p><strong>Quantidade de etiquetas:</strong> {details.total || 0}</p>
        <p><strong>Destino:</strong> {destination}</p>
      </div>

      {details.contains_ready_without_label && (
        <p className="label-generation-modal__notice">Este item foi liberado sem etiqueta, mas ainda é possível gerar as etiquetas.</p>
      )}
      {destinationMissing && (
        <p className="label-generation-modal__error">Informe o destino da venda antes de gerar as etiquetas.</p>
      )}
      {downloadFailed && (
        <p className="label-generation-modal__error">As etiquetas foram geradas, mas o PDF não pôde ser baixado.</p>
      )}

      {!downloadFailed && (
        <label className="field">
          <span className="field__label">Número da Nota Fiscal</span>
          <input
            className="field__input"
            value={invoiceNumber}
            onChange={(event) => onInvoiceChange(event.target.value)}
            autoFocus
            required
          />
        </label>
      )}
    </ConfirmModal>
  );
}
