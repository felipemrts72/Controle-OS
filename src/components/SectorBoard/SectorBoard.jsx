import { TaskCard } from '../TaskCard/TaskCard.jsx';
import './SectorBoard.css';

export function SectorBoard({ tasks }) {
  return (
    <section className="sector-board">
      {tasks.length === 0 && <p className="sector-board__empty">Nenhuma tarefa pendente.</p>}
      {tasks.map((task) => <TaskCard key={task.id} task={task} tv />)}
    </section>
  );
}
