import { query } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { dateOnly } from './vacationRules.js';
import { getCompanyPdfData } from './companySettingsService.js';
import { buildVacationProgrammedReportPdf } from './pdf/vacationProgrammedReportPdfService.js';

export function reportDateRange(filters = {}) {
  const start = filters.start_date ? dateOnly(filters.start_date) : null;
  const end = filters.end_date ? dateOnly(filters.end_date) : null;
  if (start && end && start > end) throw httpError(400, 'A data inicial deve ser anterior ou igual à data final.');
  return { start, end };
}

export async function vacationProgrammedReport(filters = {}, dependencies = {}) {
  const { start, end } = reportDateRange(filters);
  const database = dependencies.query || query;
  const companyData = dependencies.getCompanyPdfData || getCompanyPdfData;
  const buildPdf = dependencies.buildPdf || buildVacationProgrammedReportPdf;
  const rows = (await database(`
    SELECT l.id, l.employee_id, l.period_id, l.start_date::text AS start_date, l.end_date::text AS end_date, l.days, l.bonus_days,
           e.full_name, e.job_title, e.cpf,
           p.acquisition_start::text AS acquisition_start, p.acquisition_end::text AS acquisition_end
    FROM vacation_leaves l
    JOIN employees e ON e.id = l.employee_id
    JOIN vacation_periods p ON p.id = l.period_id AND p.employee_id = l.employee_id
    WHERE l.status = 'programada'
      AND ($1::date IS NULL OR l.end_date >= $1::date)
      AND ($2::date IS NULL OR l.start_date <= $2::date)
    ORDER BY l.start_date, e.full_name, l.id
  `, [start, end])).rows;
  if (!rows.length) throw httpError(404, 'Nenhuma férias programada encontrada para o intervalo selecionado.');
  const emittedAt = dependencies.emittedAt || new Date();
  const pdf = await buildPdf({ rows, company: await companyData(), range: { start, end }, emittedAt });
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(emittedAt);
  return { pdf, filename: `Ferias_Programadas_${date}.pdf` };
}
