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

  function observation(item) {
    if (item.override_used) return 'Limite ultrapassado por autorização';
    if (item.threshold_warning_confirmed) return 'Confirmado acima de 40%';
    return '-';
  }

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
        <table className="advance-summary__conference-table">
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Valor desta lista</th>
              <th>Chave Pix</th>
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
                <td>{item.pix_key || '-'}</td>
                <td>{formatMoney(item.salary)}</td>
                <td>{formatMoney(item.maximum_limit)} ({item.maximum_percentage}%)</td>
                <td>{formatMoney(item.accumulated_current_cycle)}</td>
                <td>{formatMoney(item.remaining)}</td>
                <td>{observation(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="advance-summary__cards">
          {summary.items.map((item) => (
            <article className="advance-summary__card" key={item.id}>
              <h3>{item.employee_name}</h3>
              <dl>
                <div><dt>Valor desta lista</dt><dd>{formatMoney(item.amount)}</dd></div>
                <div><dt>Chave Pix</dt><dd>{item.pix_key || '-'}</dd></div>
                <div><dt>Salário atual</dt><dd>{formatMoney(item.salary)}</dd></div>
                <div><dt>Limite máximo aplicável</dt><dd>{formatMoney(item.maximum_limit)} ({item.maximum_percentage}%)</dd></div>
                <div><dt>Acumulado no ciclo</dt><dd>{formatMoney(item.accumulated_current_cycle)}</dd></div>
                <div><dt>Restante disponível</dt><dd>{formatMoney(item.remaining)}</dd></div>
                <div><dt>Observação/override</dt><dd>{observation(item)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
