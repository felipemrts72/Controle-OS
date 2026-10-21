import { formatMoney } from '../EmployeesPage/employeeUtils.js';

const cents = (value) => Math.round(Number(value || 0) * 100);

export function AdvanceLimitPreview({ employee, amount, name, hideName = false }) {
  if (!employee) return null;
  const salary = cents(employee.current_salary);
  if (!salary) return <p role="alert" className="advances-page__limit-alert">Salário atual inválido. Regularize o cadastro antes de lançar Vales.</p>;
  const used = cents(employee.used_amount);
  const requested = cents(amount);
  const projected = used + requested;
  const recommended = Math.round(salary * 0.4);
  const maximum = Math.round(salary * 0.6);
  const percentage = projected / salary * 100;
  const state = projected > maximum ? 'blocked' : projected > recommended ? 'warning' : 'normal';
  return <div className={`advances-page__limit-preview advances-page__limit-preview_${state}`}>
    {!hideName && <strong>{name || employee.employee_name || employee.full_name}</strong>}
    <dl>
      <div><dt>Limite mensal</dt><dd>{formatMoney(maximum / 100)}</dd></div>
      <div><dt>Já retirado</dt><dd>{formatMoney(used / 100)}</dd></div>
      <div><dt>Disponível agora</dt><dd>{formatMoney(Math.max(0, maximum - used) / 100)}</dd></div>
      <div><dt>Total com este Vale</dt><dd>{formatMoney(projected / 100)}</dd></div>
    </dl>
    <div className="advances-page__limit-track" role="meter" aria-label="Utilização projetada" aria-valuenow={Number(percentage.toFixed(2))} aria-valuemin={0} aria-valuemax={Math.max(100, Math.ceil(percentage))}>
      <span style={{ width: `${Math.min(100, percentage)}%` }} />
      <i className="advances-page__limit-mark60" />
    </div>
    <small>{percentage.toFixed(2).replace('.', ',')}% · limite de 60%</small>
    {state === 'warning' && <p role="status">Acima dos 40% recomendados. Lançamento permitido até 60%. Novos Vales poderão ficar sujeitos aos dias fixos da empresa.</p>}
    {state === 'blocked' && <p role="alert">Teto de 60% ultrapassado. Necessária autorização administrativa.</p>}
  </div>;
}
