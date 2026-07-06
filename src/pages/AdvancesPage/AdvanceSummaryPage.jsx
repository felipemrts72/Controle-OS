import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { formatDate, formatMoney } from '../EmployeesPage/employeeUtils.js';
import './AdvancesPage.css';

export function AdvanceSummaryPage() {
  const { id } = useParams();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get(`/advances/lists/${id}/summary`).then((response) => setSummary(response.data));
  }, [id]);

  if (!summary) return <main className="advance-summary">Carregando resumo...</main>;

  return (
    <main className="advance-summary">
      <section>
        <h1>LISTA DE VALES</h1>
        <p>Data: {formatDate(summary.list_date)}</p>
        <table>
          <thead><tr><th>Funcionário</th><th>Valor solicitado</th></tr></thead>
          <tbody>
            {summary.items.map((item) => <tr key={item.id}><td>{item.employee_name}</td><td>{formatMoney(item.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><th>TOTAL</th><th>{formatMoney(summary.total_amount)}</th></tr></tfoot>
        </table>
      </section>

      <section>
        <h2>CONFERÊNCIA DE LIMITES</h2>
        <table>
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Valor desta lista</th>
              <th>Salário atual</th>
              <th>Limite máximo aplicável</th>
              <th>Acumulado no ciclo</th>
              <th>Restante disponível</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {summary.items.map((item) => (
              <tr key={item.id}>
                <td>{item.employee_name}</td>
                <td>{formatMoney(item.amount)}</td>
                <td>{formatMoney(item.salary)}</td>
                <td>{formatMoney(item.maximum_limit)} ({item.maximum_percentage}%)</td>
                <td>{formatMoney(item.accumulated_current_cycle)}</td>
                <td>{formatMoney(item.remaining)}</td>
                <td>{item.override_used ? 'Limite ultrapassado por autorização' : item.threshold_warning_confirmed ? 'Confirmado acima de 40%' : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
