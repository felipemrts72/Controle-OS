import fs from 'node:fs';
import {
  completeEmployeeProfile,
  createEmployee,
  getDocument,
  getEmployee,
  getEmployeeIncompleteRegistrationReport,
  getIncompleteRegistrationReport,
  getPrintData,
  listDependents,
  listDocuments,
  listEmployeeAudit,
  listEmployees,
  listMealAllowanceHistory,
  listSalaryHistory,
  removeDependent,
  removeDocument,
  saveDependent,
  updateEmployee,
  updateEmployeeStatus,
  updateMealAllowance,
  updateSalary,
  uploadDocument,
} from '../services/employeeService.js';
import { getEmployeeAdvanceProfile } from '../services/advanceService.js';
import { buildEmployeeProfilePdf } from '../services/pdf/employeePdfService.js';
import { buildEmployeePendingReportPdf } from '../services/pdf/employeePendingPdfService.js';
import { sendPdfResponse } from '../services/pdf/pdfDocument.js';
import { getCompanyPdfData } from '../services/companySettingsService.js';
import { httpError } from '../utils/httpError.js';

function selectPendingReportItems(employees, selections) {
  if (selections === undefined) return employees;
  if (!Array.isArray(selections)) throw httpError(400, 'Seleção de pendências inválida.');

  const selectionsByEmployee = new Map(selections.map((selection) => [
    selection?.employee_id,
    Array.isArray(selection?.pending_indexes) ? selection.pending_indexes : [],
  ]));
  const selectedEmployees = employees.map((employee) => {
    const indexes = [...new Set(selectionsByEmployee.get(employee.id) || [])]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < employee.pendencies.length);
    return { ...employee, pendencies: indexes.map((index) => employee.pendencies[index]) };
  }).filter((employee) => employee.pendencies.length > 0);

  if (!selectedEmployees.length) throw httpError(400, 'Selecione ao menos uma pendência.');
  return selectedEmployees;
}

export async function index(req, res, next) {
  try {
    res.json(await listEmployees({ user: req.user, query: req.query }));
  } catch (error) { next(error); }
}

export async function show(req, res, next) {
  try {
    res.json(await getEmployee(req.params.id, req.user));
  } catch (error) { next(error); }
}

export async function store(req, res, next) {
  try {
    res.status(201).json(await createEmployee(req.body, req.user, { complete: true }));
  } catch (error) {
    if (error.code === '23505') error.status = 409;
    next(error);
  }
}

export async function completeProfile(req, res, next) {
  try {
    res.json(await completeEmployeeProfile(req.params.id, req.body, req.user));
  } catch (error) {
    if (error.code === '23505') error.status = 409;
    next(error);
  }
}

export async function quickStore(req, res, next) {
  try {
    res.status(201).json(await createEmployee(req.body, req.user, { quick: true }));
  } catch (error) {
    if (error.code === '23505') error.status = 409;
    next(error);
  }
}

export async function update(req, res, next) {
  try {
    res.json(await updateEmployee(req.params.id, req.body, req.user));
  } catch (error) {
    if (error.code === '23505') error.status = 409;
    next(error);
  }
}

export async function updateStatus(req, res, next) {
  try {
    res.json(await updateEmployeeStatus(req.params.id, req.body.status, req.user));
  } catch (error) { next(error); }
}

export async function salaryHistory(req, res, next) {
  try {
    res.json(await listSalaryHistory(req.params.id));
  } catch (error) { next(error); }
}

export async function salaryStore(req, res, next) {
  try {
    res.json(await updateSalary(req.params.id, req.body, req.user));
  } catch (error) { next(error); }
}

export async function mealAllowanceHistory(req, res, next) {
  try {
    res.json(await listMealAllowanceHistory(req.params.id));
  } catch (error) { next(error); }
}

export async function mealAllowanceStore(req, res, next) {
  try {
    res.json(await updateMealAllowance(req.params.id, req.body, req.user));
  } catch (error) { next(error); }
}

export async function dependentsIndex(req, res, next) {
  try {
    res.json(await listDependents(req.params.id));
  } catch (error) { next(error); }
}

export async function dependentStore(req, res, next) {
  try {
    res.status(201).json(await saveDependent(req.params.id, null, req.body, req.user));
  } catch (error) { next(error); }
}

export async function dependentUpdate(req, res, next) {
  try {
    res.json(await saveDependent(req.params.id, req.params.dependentId, req.body, req.user));
  } catch (error) { next(error); }
}

export async function dependentDestroy(req, res, next) {
  try {
    await removeDependent(req.params.id, req.params.dependentId, req.user);
    res.status(204).send();
  } catch (error) { next(error); }
}

export async function documentsIndex(req, res, next) {
  try {
    res.json(await listDocuments(req.params.id));
  } catch (error) { next(error); }
}

export async function documentStore(req, res, next) {
  try {
    const metadata = {
      documentType: req.header('x-document-type') || 'outro',
      originalName: req.header('x-original-name') || 'documento',
      dependentId: req.header('x-dependent-id') || null,
      mimeType: req.header('content-type'),
    };
    res.status(201).json(await uploadDocument(req.params.id, metadata, req.body, req.user));
  } catch (error) { next(error); }
}

export async function documentShow(req, res, next) {
  try {
    const document = await getDocument(req.params.id, req.params.documentId);
    res.setHeader('Content-Type', document.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.original_name)}"`);
    fs.createReadStream(document.fullPath).on('error', next).pipe(res);
  } catch (error) { next(error); }
}

export async function documentDestroy(req, res, next) {
  try {
    await removeDocument(req.params.id, req.params.documentId, req.user);
    res.status(204).send();
  } catch (error) { next(error); }
}

export async function printData(req, res, next) {
  try {
    res.json(await getPrintData(req.params.id, req.user));
  } catch (error) { next(error); }
}

export async function profilePdf(req, res, next) {
  try {
    const [data, company] = await Promise.all([
      getPrintData(req.params.id, req.user),
      getCompanyPdfData(),
    ]);
    const pdf = await buildEmployeeProfilePdf(data, { company });
    sendPdfResponse(res, pdf, `ficha-cadastral-${data.employee.full_name}.pdf`);
  } catch (error) { next(error); }
}

export async function incompleteReportPdf(req, res, next) {
  try {
    const [employees, company] = await Promise.all([
      getIncompleteRegistrationReport(),
      getCompanyPdfData(),
    ]);
    const selectedEmployees = selectPendingReportItems(employees, req.body?.selections);
    const emittedAt = new Date();
    const pdf = await buildEmployeePendingReportPdf(selectedEmployees, { company, emittedAt });
    const filenameDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Cuiaba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(emittedAt);
    sendPdfResponse(res, pdf, `pendencias-cadastrais-funcionarios-${filenameDate}.pdf`);
  } catch (error) { next(error); }
}

export async function incompleteReportPreview(_req, res, next) {
  try {
    res.json(await getIncompleteRegistrationReport());
  } catch (error) { next(error); }
}

export async function employeeIncompleteReportPdf(req, res, next) {
  try {
    const [employee, company] = await Promise.all([
      getEmployeeIncompleteRegistrationReport(req.params.id),
      getCompanyPdfData(),
    ]);
    const selectedEmployees = selectPendingReportItems([employee], req.body?.selections);
    const pdf = await buildEmployeePendingReportPdf(selectedEmployees, { company, emittedAt: new Date() });
    sendPdfResponse(res, pdf, `ficha-incompleta-${employee.full_name}.pdf`);
  } catch (error) { next(error); }
}

export async function employeeIncompleteReportPreview(req, res, next) {
  try {
    res.json(await getEmployeeIncompleteRegistrationReport(req.params.id));
  } catch (error) { next(error); }
}

export async function auditIndex(req, res, next) {
  try {
    res.json(await listEmployeeAudit(req.params.id));
  } catch (error) { next(error); }
}

export async function advancesProfile(req, res, next) {
  try {
    res.json(await getEmployeeAdvanceProfile(req.params.id));
  } catch (error) { next(error); }
}
