import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { LabelPreviewCard } from '../../components/LabelPreviewCard/LabelPreviewCard.jsx';
import './LabelQueuePage.css';

export function LabelQueuePage() {
  const [volumes, setVolumes] = useState([]);

  async function load() {
    const response = await api.get('/labels/queue');
    setVolumes(response.data.filter((volume) => volume.order_status !== 'deleted' && !volume.deleted_at && !volume.order_deleted_at));
  }

  useEffect(() => { load(); }, []);

  return (
    <section className="page label-queue-page">
      <div className="page__header">
        <h1 className="page__title">Fila de Etiquetas</h1>
      </div>
      <div className="label-queue-page__list">
        {volumes.map((volume) => <LabelPreviewCard key={volume.id} volume={volume} onGenerated={load} />)}
        {volumes.length === 0 && <div className="panel">Nenhuma etiqueta liberada.</div>}
      </div>
    </section>
  );
}
