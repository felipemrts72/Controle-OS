import * as payments from '../services/employeePaymentService.js';
import { getCompanyPdfData } from '../services/companySettingsService.js';
import { addTable, addTotalLine, createPdfDocument, finalizePdf, formatCurrencyBR, formatDateTimeBR, sendPdfResponse } from '../services/pdf/pdfDocument.js';

export const list = async (_req, res, next) => {
  try { res.json(await payments.listPayments()); } catch (error) { next(error); }
};
export const employees = async (_req, res, next) => {
  try { res.json(await payments.paymentEmployees()); } catch (error) { next(error); }
};
export const show = async (req, res, next) => {
  try { res.json(await payments.getPayment(req.params.id)); } catch (error) { next(error); }
};
export const save = async (req, res, next) => {
  try {
    const payment = await payments.savePayment(req.params.id, req.body, req.user.id);
    res.status(req.params.id ? 200 : 201).json(payment);
  } catch (error) { next(error); }
};
export const finalize = async (req, res, next) => {
  try { res.json(await payments.finalizePayment(req.params.id, req.body?.version, req.user.id)); }
  catch (error) { next(error); }
};

export async function buildPaymentPdf(payment, company) {
  const timeZone = 'America/Cuiaba';
  const date = formatDateTimeBR(payment.finalized_at || payment.created_at, timeZone);
  const context = createPdfDocument({
    title: 'Relação de pagamentos',
    subtitle: `Pagamento nº ${payment.id} • ${payment.finalized_at ? 'Finalizado' : 'Rascunho'} • ${date}`,
    company, timeZone,
  });
  addTable(context, {
    columns: [
      { key: 'full_name', label: 'Nome do funcionário', width: 0.37 },
      { key: 'pix_key', label: 'Chave Pix', width: 0.43, format: (key) => key || 'Pendente' },
      { key: 'amount_cents', label: 'Valor', width: 0.20, align: 'right', format: (cents) => formatCurrencyBR(cents / 100) },
    ],
    rows: payment.items,
    keepWithNextHeight: 38,
  });
  addTotalLine(context, 'Total', formatCurrencyBR(payment.total_cents / 100));
  return finalizePdf(context);
}

export const pdf = async (req, res, next) => {
  try {
    const payment = await payments.getPayment(req.params.id);
    sendPdfResponse(res, await buildPaymentPdf(payment, await getCompanyPdfData()), `pagamento-${payment.id}.pdf`);
  } catch (error) { next(error); }
};
