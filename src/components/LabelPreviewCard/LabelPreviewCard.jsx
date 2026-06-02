import { StatusBadge } from '../StatusBadge/StatusBadge.jsx';
import { LabelActions } from '../LabelActions/LabelActions.jsx';
import './LabelPreviewCard.css';

export function LabelPreviewCard({ volume, onGenerated }) {
  return (
    <article className="label-preview">
      <div>
        <strong>{volume.customer_name}</strong>
        <p className="label-preview__meta">Venda {volume.sale_number} · {volume.product_name_snapshot}</p>
      </div>
      <div className="label-preview__volume">Volume {volume.volume_number}/{volume.total_volumes}</div>
      <div>{Number(volume.weight_kg).toLocaleString('pt-BR')} kg</div>
      <StatusBadge value={volume.label_status} />
      <LabelActions volume={volume} onGenerated={onGenerated} />
    </article>
  );
}
