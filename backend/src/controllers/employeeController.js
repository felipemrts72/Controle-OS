import fs from 'node:fs';
import {
  completeEmployeeProfile,
  createEmployee,
  getDocument,
  getEmployee,
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
