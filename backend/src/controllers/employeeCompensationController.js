import { compensationEmployees, updateCompensation, compensationReport } from '../services/employeeCompensationService.js';
import { buildCompensationPdf } from '../services/pdf/employeeCompensationPdfService.js';
import { getCompanyPdfData, getCompanySettings } from '../services/companySettingsService.js';
import { formatCnpjBR, sendPdfResponse } from '../services/pdf/pdfDocument.js';

export async function employees(req, res, next) {
  try { res.json(await compensationEmployees(req.user)); } catch (error) { next(error); }
}
export async function update(req, res, next) {
  try { res.json(await updateCompensation(req.params.id, req.body, req.user)); } catch (error) { next(error); }
}
export async function report(req, res, next) {
  try {
    const data = await compensationReport(req.query, req.user);
    const company = await getCompanySettings();
    res.json({
      ...data,
      company: {
        name: company.nome_fantasia || company.razao_social,
        cnpj: company.cnpj ? formatCnpjBR(company.cnpj) : null,
      },
      emitted_at: new Date().toISOString(),
    });
  } catch (error) { next(error); }
}
export async function pdf(req, res, next) {
  try {
    const data = await compensationReport(req.query, req.user);
    sendPdfResponse(res, await buildCompensationPdf(data, await getCompanyPdfData()), `modificacoes-${data.year}-${String(data.month).padStart(2, '0')}.pdf`);
  } catch (error) { next(error); }
}
