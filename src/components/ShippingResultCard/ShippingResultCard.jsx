import { StatusBadge } from '../StatusBadge/StatusBadge.jsx';
import './ShippingResultCard.css';

export function ShippingResultCard({ volumes, onConfirmCode, onConfirmSale }) {
  if (!volumes?.length) return null;
  const forced = volumes.some((volume) => !['label_generated', 'ready_without_label', 'shipped'].includes(volume.label_status));
  return (
    <section className="shipping-result panel">
      {forced && <p className="shipping-result__alert">Esta OS possui volumes ainda não concluídos ou sem etiqueta. Deseja expedir mesmo assim?</p>}
      {volumes.map((volume) => (
        <div className="shipping-result__row" key={volume.id}>
          <strong>{volume.customer_name}</strong>
          <span>Venda {volume.sale_number}</span>
          <span>Volume {volume.volume_number}/{volume.total_volumes}</span>
          <StatusBadge value={volume.label_status} />
          {volumes.length === 1 && <button className="button button_primary" type="button" onClick={() => onConfirmCode(volume.shipment_code)}>Confirmar expedição</button>}
        </div>
      ))}
      {volumes.length > 1 && <button className="button button_primary shipping-result__button" type="button" onClick={() => onConfirmSale(volumes[0].sale_number)}>Confirmar venda inteira</button>}
    </section>
  );
}
