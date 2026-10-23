import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { article130Days, dateOnly } from './vacationRules.js';
import { getCompanyPdfData } from './companySettingsService.js';
import { buildVacationAccountingPdf } from './pdf/vacationAccountingPdfService.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valid = (value) => { if (!uuid.test(String(value))) throw httpError(400, 'Identificador inválido.'); return value; };

export async function vacationAccountingPdf(employeeId, periodId, leaveId, actor) {
  const data = await transaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    const employee = (await client.query('SELECT e.full_name,e.admission_date,e.job_title,s.name AS sector_name FROM employees e LEFT JOIN sectors s ON s.id=e.sector_id WHERE e.id=$1 AND e.deleted_at IS NULL', [valid(employeeId)])).rows[0];
    const period = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2', [valid(periodId), employeeId])).rows[0];
    const leave = (await client.query("SELECT * FROM vacation_leaves WHERE id=$1 AND employee_id=$2 AND period_id=$3 AND status='programada'", [valid(leaveId), employeeId, periodId])).rows[0];
    if (!employee || !period || !leave) throw httpError(404, 'Programação de férias não encontrada.');
    const absences = (await client.query('SELECT quantity,classification FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL', [periodId])).rows;
    if (!period.reviewed_at || period.special_case || absences.some((a) => a.classification === 'pendente' || (a.classification === 'injustificada' && Number(a.quantity) === 0.5))) throw httpError(409, 'Direito adquirido pendente de conferência.');
    const entitlement = article130Days(absences.filter((a) => a.classification === 'injustificada' && Number(a.quantity) === 1).length);
    const others = (await client.query("SELECT * FROM vacation_leaves WHERE period_id=$1 AND id<>$2 AND status<>'cancelada'", [periodId, leaveId])).rows;
    return { employee, period, leave, others, entitlement };
  });
  const company = await getCompanyPdfData();
  const pdf = await buildVacationAccountingPdf({ ...data, company });
  await transaction(async (client) => {
    await client.query('INSERT INTO vacation_audit(employee_id,period_id,entity_type,entity_id,action,after_data,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [employeeId,periodId,'leave',leaveId,'accounting_pdf',JSON.stringify({ version:data.leave.version }),actor]);
  });
  const name = data.employee.full_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { pdf, filename: `Ferias_Contabilidade_${name}_${dateOnly(data.leave.start_date)}.pdf` };
}
