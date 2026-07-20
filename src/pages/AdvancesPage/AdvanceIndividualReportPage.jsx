import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { formatDate, formatMoney } from '../EmployeesPage/employeeUtils.js';
import './AdvancesPage.css';

function originLabel(entry) {
  if (entry.entry_type === 'installment') return 'Parcela de vale';
  if (entry.entry_type === 'individual') return 'Vale individual';
  return 'Lista de vales';
}

function filterLabel(filter) {
  if (filter?.type === 'period') return `Periodo: ${filter.period.from} a ${filter.period.to}`;
  if (filter?.cycle) return `Ciclo: ${formatDate(filter.cycle.opened_at)}${filter.cycle.closed_at ? ` a ${formatDate(filter.cycle.closed_at)}` : ''}`;
  return '-';
}

export function AdvanceIndividualReportPage() {
  const { employeeId } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    api.get(`/advances/reports/individual/${employeeId}`, { params: Object.fromEntries(params.entries()) })
      .then((response) => setReport(response.data))
      .catch((err) => setError(err.response?.data?.message || 'Nao foi possivel gerar o extrato.'));
  }, [employeeId]);

  if (error) return <main className="advance-print-page"><p>{error}</p></main>;
  if (!report) return <main className="advance-print-page"><p>Carregando extrato...</p></main>;

  return (
    <main className="advance-print-page">
      <header className="advance-print-page__header">
        <h1>EXTRATO INDIVIDUAL DE VALES</h1>
        <p>{report.employee.full_name}</p>
        {report.employee.job_title && <p>Cargo: {report.employee.job_title}</p>}
        <p>{filterLabel(report.filter)}</p>
      </header>

      <section className="advance-print-page__entries">
        {report.entries.map((entry) => (
          <article className="advance-print-page__entry" key={entry.id}>
            <strong>{formatDate(entry.receipt_at || entry.created_at || entry.list_date)}</strong>
            <dl>
              <div><dt>Valor</dt><dd>{formatMoney(entry.amount)}</dd></div>
              <div><dt>Origem</dt><dd>{originLabel(entry)}</dd></div>
              {entry.source_bank && <div><dt>Banco</dt><dd>{entry.source_bank}</dd></div>}
              {entry.installment_number && <div><dt>Parcela</dt><dd>{entry.installment_number} de {entry.installments_count}</dd></div>}
              {entry.original_amount && <div><dt>Valor total do vale</dt><dd>{formatMoney(entry.original_amount)}</dd></div>}
            </dl>
          </article>
        ))}
        {!report.entries.length && <p>Nenhum vale encontrado no filtro.</p>}
      </section>

      <footer className="advance-print-page__total">TOTAL DE VALES: {formatMoney(report.total_amount)}</footer>

      {report.future_plans?.length > 0 && (
        <section className="advance-print-page__future">
          <h2>Parcelamentos futuros</h2>
          {report.future_plans.map((plan) => (
            <article className="advance-print-page__entry" key={plan.id}>
              <dl>
                <div><dt>Valor total original</dt><dd>{formatMoney(plan.original_amount)}</dd></div>
                <div><dt>Parcelas lancadas</dt><dd>{plan.posted_count} de {plan.installments_count}</dd></div>
                <div><dt>Parcelas restantes</dt><dd>{plan.pending_count}</dd></div>
                <div><dt>Saldo futuro</dt><dd>{formatMoney(plan.pending_amount)}</dd></div>
                <div><dt>Status</dt><dd>{plan.status}</dd></div>
              </dl>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
