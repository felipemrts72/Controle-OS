import './TaskCard.css';

function isLate(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(date) < today;
}

export function TaskCard({ task, onReady, tv = false }) {
  const late = isLate(task.promised_date);
  return (
    <article className={`task-card ${tv ? 'task-card_tv' : ''} ${late ? 'task-card_late' : 'task-card_on-time'}`}>
      <div>
        <strong>Venda {task.sale_number}</strong>
        <p className="task-card__customer">{task.customer_name}</p>
      </div>
      <div>{task.product_name_snapshot}</div>
      <div>{task.task_name}</div>
      <div>{new Date(task.promised_date).toLocaleDateString('pt-BR')}</div>
      <strong>{late ? 'Fora do prazo' : 'Dentro do prazo'}</strong>
      {onReady && <button className="button button_primary" type="button" onClick={() => onReady(task.id)}>Marcar pronto</button>}
    </article>
  );
}
