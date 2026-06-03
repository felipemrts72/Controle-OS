import './StatusBadge.css';

const labels = {
  pending: 'Pendente',
  in_progress: 'Em Produção',
  ready_for_label: 'Pronto para Etiqueta',
  partially_shipped: 'Parcialmente Expedido',
  shipped: 'Expedido',
  deleted: 'Excluída',
  ready: 'Pronto',
  waiting_tasks: 'Aguardando tarefas',
  released_for_label: 'Liberado para etiqueta',
  label_generated: 'Etiqueta gerada',
  ready_without_label: 'Pronto sem etiqueta',
  manufactured: 'Fabricado',
  resale: 'Revenda',
  material_prima: 'Matéria-prima',
};

export function StatusBadge({ value }) {
  return <span className={`status-badge status-badge_${value}`}>{labels[value] || value}</span>;
}
