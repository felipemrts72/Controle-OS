import { useState } from 'react';
import { Download } from 'lucide-react';
import { LabelGenerationModal } from '../LabelGenerationModal/LabelGenerationModal.jsx';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import { createSingleLabel, downloadSingleLabel, labelErrorMessage } from '../../utils/labelWorkflow.js';
import './LabelActions.css';

export function LabelActions({ volume, onGenerated }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(volume.invoice_number || '');
  const [busy, setBusy] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  async function downloadExisting() {
    setBusy(true);
    try {
      await downloadSingleLabel(volume, '15x10');
      toast.success('Etiqueta baixada para reimpressão.');
    } catch (error) {
      toast.error(labelErrorMessage(error, 'Não foi possível baixar a etiqueta.'));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!invoiceNumber.trim()) {
      toast.error('Informe a Nota Fiscal antes de gerar as etiquetas.');
      return;
    }
    setBusy(true);
    try {
      await createSingleLabel(volume.id, invoiceNumber);
      onGenerated?.();
    } catch (error) {
      toast.error(labelErrorMessage(error, 'Não foi possível gerar a etiqueta.'));
      setBusy(false);
      return;
    }

    try {
      await downloadSingleLabel(volume, '15x10');
      toast.success('Etiqueta gerada e PDF baixado.');
      setOpen(false);
    } catch {
      setDownloadFailed(true);
      toast.error('A etiqueta foi gerada, mas o PDF não pôde ser baixado.');
    } finally {
      setBusy(false);
    }
  }

  async function retryDownload() {
    setBusy(true);
    try {
      await downloadSingleLabel(volume, '15x10');
      toast.success('PDF baixado com a etiqueta já gerada.');
      setOpen(false);
    } catch {
      toast.error('Não foi possível baixar o PDF. A etiqueta existente foi preservada.');
    } finally {
      setBusy(false);
    }
  }

  const hasLabel = Boolean(volume.shipment_code);
  return (
    <div className="label-actions">
      <button className="button button_primary" type="button" onClick={hasLabel ? downloadExisting : () => setOpen(true)} disabled={busy}>
        <Download size={16} /> {hasLabel ? 'Reimprimir PDF' : 'Gerar etiqueta'}
      </button>
      <LabelGenerationModal
        open={open}
        details={{
          sale_number: volume.sale_number,
          customer_name: volume.customer_name,
          product_name: volume.product_name_snapshot,
          total: 1,
          delivery_type: volume.delivery_type,
          destination_city: volume.destination_city,
          destination_uf: volume.destination_uf,
          contains_ready_without_label: volume.label_status === 'ready_without_label',
        }}
        invoiceNumber={invoiceNumber}
        onInvoiceChange={setInvoiceNumber}
        onCancel={() => setOpen(false)}
        onConfirm={generate}
        onRetryDownload={retryDownload}
        busy={busy}
        downloadFailed={downloadFailed}
      />
    </div>
  );
}
