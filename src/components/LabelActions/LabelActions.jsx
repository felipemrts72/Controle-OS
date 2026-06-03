import { Download } from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import './LabelActions.css';

export function LabelActions({ volume, onGenerated }) {
  const toast = useToast();
  async function download() {
    try {
      const isReprint = volume.label_status === 'label_generated';
      const response = await api.get(`/labels/${volume.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      onGenerated?.();
      toast.success(isReprint ? 'Etiqueta aberta para reimpressão.' : 'Etiqueta gerada com sucesso.');
    } catch {
      toast.error(volume.label_status === 'label_generated' ? 'Não foi possível abrir a etiqueta.' : 'Não foi possível gerar a etiqueta.');
    }
  }

  const label = volume.label_status === 'label_generated' ? 'Reimprimir PDF' : 'Gerar PDF';

  return (
    <div className="label-actions">
      <button className="button button_primary" type="button" onClick={download}>
        <Download size={16} /> {label}
      </button>
    </div>
  );
}
