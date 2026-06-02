import { Download, Tags } from 'lucide-react';
import { api } from '../../services/api.js';
import './LabelActions.css';

export function LabelActions({ volume, onGenerated }) {
  async function generate() {
    const response = await api.post(`/labels/${volume.id}/generate`);
    onGenerated?.(response.data);
  }

  async function download() {
    const response = await api.get(`/labels/${volume.id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="label-actions">
      <button className="button button_primary" type="button" onClick={generate}>
        <Tags size={16} /> Gerar
      </button>
      <button className="button" type="button" onClick={download}>
        <Download size={16} /> PDF
      </button>
    </div>
  );
}
