import './InternalOrderProgress.css';

export function InternalOrderProgress({ ready = 0, total = 0 }) {
  return (
    <div className="internal-order-progress">
      <div className="internal-order-progress__text">{ready} de {total} tarefas prontas</div>
      <progress className="internal-order-progress__bar" max={total || 1} value={total ? ready : 1} />
    </div>
  );
}
