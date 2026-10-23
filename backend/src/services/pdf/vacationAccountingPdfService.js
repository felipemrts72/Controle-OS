import { addKeyValueGrid, addParagraph, addSectionTitle, createPdfDocument, finalizePdf, formatDateBR } from './pdfDocument.js';
import { addDays } from '../vacationRules.js';

const date = (value) => value ? formatDateBR(value, 'America/Cuiaba') : 'Pendente de conferência';
const value = (number) => `${number} dias`;

export async function buildVacationAccountingPdf({ employee, period, leave, others, entitlement, company }) {
  const taken = others.filter((item) => ['gozada', 'historica'].includes(item.status)).reduce((sum, item) => sum + Number(item.days), 0);
  const planned = others.filter((item) => item.status === 'programada').reduce((sum, item) => sum + Number(item.days), 0);
  const otherBonus = others.reduce((sum, item) => sum + Number(item.bonus_days || 0), 0);
  const context = createPdfDocument({ title: 'PROGRAMAÇÃO DE FÉRIAS — CONTABILIDADE', subtitle: `Emissão: ${date(new Date())}`, company: { ...company, nome_fantasia: company.razao_social || company.nome_fantasia }, emittedAt: new Date(), timeZone: 'America/Cuiaba', margins: { top: 32, right: 38, bottom: 46, left: 38 } });
  addSectionTitle(context, 'Funcionário');
  addKeyValueGrid(context, [
    { label: 'Nome completo', value: employee.full_name }, { label: 'Admissão', value: date(employee.admission_date) },
    { label: 'Cargo', value: employee.job_title || 'Pendente de conferência' }, { label: 'Setor', value: employee.sector_name || 'Pendente de conferência' },
  ]);
  addSectionTitle(context, 'Período aquisitivo');
  addKeyValueGrid(context, [
    { label: 'Início', value: date(period.acquisition_start) }, { label: 'Fim', value: date(period.acquisition_end) },
    { label: 'Direito adquirido', value: value(entitlement) }, { label: 'Período concessivo', value: `${date(period.concession_start)} a ${date(period.concession_end)}` },
    { label: 'Data-limite de concessão', value: date(period.concession_end) },
  ]);
  addSectionTitle(context, 'Programação');
  addKeyValueGrid(context, [
    { label: 'Início do gozo', value: date(leave.start_date) }, { label: 'Término do gozo', value: date(leave.end_date) },
    { label: 'Dias corridos', value: value(leave.days) }, { label: 'Retorno previsto', value: date(addDays(leave.end_date, 1)) },
    { label: 'Abono pecuniário', value: value(leave.bonus_days || 0) }, { label: 'Já gozados anteriormente', value: value(taken) },
    { label: 'Outros lançamentos programados', value: value(planned) }, { label: 'Saldo após a programação', value: value(entitlement - taken - planned - otherBonus - Number(leave.days) - Number(leave.bonus_days || 0)) },
  ]);
  if (leave.bonus_requested_at) addParagraph(context, `Data do pedido de abono: ${date(leave.bonus_requested_at)}`);
  if (leave.notes) addParagraph(context, `Observações: ${leave.notes}`);
  const pending = [!company.razao_social && 'razão social', !company.cnpj && 'CNPJ', !employee.job_title && 'cargo', !employee.sector_name && 'setor', Number(leave.bonus_days || 0) > 0 && !leave.bonus_requested_at && 'data e prazo do pedido de abono'].filter(Boolean);
  if (pending.length) addParagraph(context, `Pendente de conferência: ${pending.join(', ')}.`);
  addParagraph(context, 'Demonstrativo administrativo de programação. Cálculos financeiros a cargo da contabilidade. Não constitui recibo de pagamento nem aviso de férias.');
  return finalizePdf(context);
}
