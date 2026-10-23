import { addKeyValueGrid, addParagraph, addSectionTitle, addTable, createPdfDocument, finalizePdf, formatDateBR } from './pdfDocument.js';
import { addDays } from '../vacationRules.js';

const date = (value) => value ? formatDateBR(value, 'America/Cuiaba') : 'Pendente de conferência';
const value = (number) => number == null ? 'A apurar' : `${number} dias`;

export async function buildVacationAccountingPdf({ employee, period, leave, others, entitlement, entitlementSource, company }) {
  const taken = others.filter((item) => ['gozada', 'historica'].includes(item.status)).reduce((sum, item) => sum + Number(item.days), 0);
  const planned = others.filter((item) => item.status === 'programada').reduce((sum, item) => sum + Number(item.days), 0);
  const otherBonus = others.reduce((sum, item) => sum + Number(item.bonus_days || 0), 0);
  const currentBonus = Number(leave.bonus_days || 0);
  const totalBonus = otherBonus + currentBonus;
  const available = entitlement == null ? null : entitlement - taken - planned - otherBonus - Number(leave.days) - currentBonus;
  const context = createPdfDocument({ title: 'PROGRAMAÇÃO DE FÉRIAS — CONTABILIDADE', subtitle: `Emissão: ${date(new Date())}`, company: { ...company, nome_fantasia: company.razao_social || company.nome_fantasia }, emittedAt: new Date(), timeZone: 'America/Cuiaba', margins: { top: 32, right: 38, bottom: 46, left: 38 } });
  addSectionTitle(context, 'Empresa');
  addKeyValueGrid(context, [{ label: 'Razão social', value: company.razao_social || 'A confirmar' }, { label: 'CNPJ', value: company.cnpj || 'A confirmar' }]);
  addSectionTitle(context, 'Funcionário');
  addKeyValueGrid(context, [
    { label: 'Nome completo', value: employee.full_name }, { label: 'Identificação interna', value: employee.id }, { label: 'Admissão', value: date(employee.admission_date) },
    { label: 'Cargo', value: employee.job_title || 'Pendente de conferência' }, { label: 'Setor', value: employee.sector_name || 'Pendente de conferência' },
  ]);
  addSectionTitle(context, 'Período aquisitivo');
  addKeyValueGrid(context, [
    { label: 'Início', value: date(period.acquisition_start) }, { label: 'Fim', value: date(period.acquisition_end) },
    { label: 'Direito adquirido', value: value(entitlement) }, { label: 'Período concessivo', value: `${date(period.concession_start)} a ${date(period.concession_end)}` },
    { label: 'Data-limite de concessão', value: date(period.concession_end) },
  ]);
  addSectionTitle(context, 'Lançamento de férias');
  addKeyValueGrid(context, [
    { label: 'Início do gozo', value: date(leave.start_date) }, { label: 'Término do gozo', value: date(leave.end_date) },
    { label: 'Dias corridos', value: value(leave.days) }, { label: 'Retorno previsto', value: date(addDays(leave.end_date, 1)) },
    { label: 'Situação', value: leave.status === 'historica' ? 'Histórico registrado' : leave.status === 'gozada' ? 'Gozada' : 'Programada' },
    { label: 'Abono deste lançamento', value: value(currentBonus) }, { label: 'Abono total do período', value: value(totalBonus) },
    { label: 'Dias já gozados em outros lançamentos', value: value(taken) }, { label: 'Dias programados em outros lançamentos', value: value(planned) },
    { label: 'Saldo livre após o lançamento', value: value(available) },
  ]);
  addSectionTitle(context, 'Outros períodos de gozo');
  addTable(context, { columns: [
    { key: 'dates', label: 'Datas', width: 0.48 }, { key: 'days', label: 'Dias', width: 0.16 },
    { key: 'status', label: 'Situação', width: 0.2 }, { key: 'bonus', label: 'Abono', width: 0.16 },
  ], rows: others.map((item) => ({ dates: `${date(item.start_date)} a ${date(item.end_date)}`, days: String(item.days), status: item.status, bonus: String(item.bonus_days || 0) })), emptyMessage: 'Nenhum outro período de gozo registrado.' });
  if (leave.bonus_requested_at) addParagraph(context, `Data do pedido de abono: ${date(leave.bonus_requested_at)}`);
  if (leave.notes) addParagraph(context, `Observações: ${leave.notes}`);
  addParagraph(context, `Pagamento: ${leave.payment_confirmed_at ? `confirmado em ${date(leave.payment_confirmed_at)}` : 'confirmação não registrada'}${leave.payment_due_date ? `; prazo registrado: ${date(leave.payment_due_date)}` : ''}.`);
  const pending = [!company.razao_social && 'razão social', !company.cnpj && 'CNPJ', !employee.job_title && 'cargo', !employee.sector_name && 'setor', entitlement == null && 'direito adquirido', entitlementSource === 'historical_estimate' && 'direito histórico estimado', Number(leave.bonus_days || 0) > 0 && !leave.bonus_requested_at && 'data e prazo do pedido de abono'].filter(Boolean);
  if (pending.length) addParagraph(context, `Pendente de conferência: ${pending.join(', ')}.`);
  addParagraph(context, 'Demonstrativo administrativo de programação. Cálculos financeiros a cargo da contabilidade. Não constitui recibo de pagamento nem aviso de férias.');
  return finalizePdf(context);
}
