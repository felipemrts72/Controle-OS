import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { formatDate, formatMoney } from '../EmployeesPage/employeeUtils.js';
import './AdvancesPage.css';

function filterLabel(filter) {
  if (filter?.type === 'period') return `Periodo: ${filter.period.from} a ${filter.period.to}`;
  if (filter?.cycle) return `Ciclo: ${formatDate(filter.cycle.opened_at)}${filter.cycle.closed_at ? ` a ${formatDate(filter.cycle.closed_at)}` : ''}`;
  return '-';
}

export function AdvanceGeneralReportPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    api.get('/advances/reports/general', { params: Object.fromEntries(params.entries()) })
      .then((response) => setReport(response.data))
      .catch((err) => setError(err.response?.data?.message || 'Nao foi possivel gerar o relatorio.'));
  }, []);

  if (error) return <main className="advance-print-page"><p>{error}</p></main>;
  if (!report) return <main className="advance-print-page"><p>Carregando relatorio...</p></main>;

  return (
    <main className="advance-print-page">
      <header className="advance-print-page__header">
        <h1>RELATORIO GERAL DE VALES</h1>
        <p>{filterLabel(report.filter)}</p>
        {report.filter?.cycle && (
          <p>
            Status: {report.filter.cycle.status} · Aberto por {report.filter.cycle.opened_by_name || '-'}
            {report.filter.cycle.closed_at ? ` · Fechado por ${report.filter.cycle.closed_by_name || '-'}` : ''}
          </p>
        )}
      </header>

      <section className="advance-print-page__table">
        <table>
          <thead><tr><th>Funcionario</th><th>Total de vales</th></tr></thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.employee_id}><td>{row.employee_name}</td><td>{formatMoney(row.total_amount)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th>TOTAL GERAL</th><th>{formatMoney(report.total_amount)}</th></tr></tfoot>
        </table>
      </section>
    </main>
  );
}
