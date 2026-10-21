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
          <thead><tr><th>Funcionário</th><th>Chave Pix</th><th>Valor</th></tr></thead>
          <tbody>
            {summary.items.map((item) => <tr key={item.id}><td>{item.employee_name}</td><td className="advance-summary__pix">{item.pix_key || 'Não cadastrada'}</td><td>{formatMoney(item.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><th colSpan="2">TOTAL</th><th>{formatMoney(summary.total_amount)}</th></tr></tfoot>
        </table>
      </section>

    </main>
  );
}
