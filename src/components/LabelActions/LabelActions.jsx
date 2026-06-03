import { Download } from 'lucide-react';
import { api } from '../../services/api.js';
import './LabelActions.css';

export function LabelActions({ volume, onGenerated }) {
  async function download() {
    const response = await api.get(`/labels/${volume.id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    window.open(url, '_blank', 'noopener,noreferrer');
    onGenerated?.();
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
