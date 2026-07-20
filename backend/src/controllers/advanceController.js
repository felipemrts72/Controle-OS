import {
  approveAdvanceList,
  closeCycle,
  createAdvanceList,
  createIndividualAdvance,
  createCycle,
  convertIndividualAdvanceToInstallments,
  getAdvanceAuditReport,
  getAdvanceList,
  getClosedAdvanceCyclesReport,
  getGeneralAdvanceReport,
  getAdvancesHome,
  getAdvanceSummary,
  getIndividualAdvanceReport,
  lookupAdvanceLimits,
  listEligibleIndividualAdvances,
  listAdvanceEmployees,
  listCycles,
  removeAdvanceItem,
  saveAdvanceItem,
  submitAdvanceList,
  updateAdvanceList,
} from '../services/advanceService.js';

export async function home(req, res, next) {
  try {
    res.json(await getAdvancesHome(req.user));
  } catch (error) { next(error); }
}

export async function employees(req, res, next) {
  try {
    res.json(await listAdvanceEmployees(req.query));
  } catch (error) { next(error); }
}

export async function limitLookup(req, res, next) {
  try {
    res.json(await lookupAdvanceLimits(req.query));
  } catch (error) { next(error); }
}

export async function individualStore(req, res, next) {
  try {
    res.status(201).json(await createIndividualAdvance(req.body, req.user));
  } catch (error) { next(error); }
}

export async function eligibleInstallments(req, res, next) {
  try {
    res.json(await listEligibleIndividualAdvances(req.query.employee_id, req.user));
  } catch (error) { next(error); }
}

export async function installmentConvert(req, res, next) {
  try {
    res.json(await convertIndividualAdvanceToInstallments(req.params.itemId, req.body, req.user));
  } catch (error) { next(error); }
}

export async function generalReport(req, res, next) {
  try {
    res.json(await getGeneralAdvanceReport(req.query, req.user));
  } catch (error) { next(error); }
}

export async function individualReport(req, res, next) {
  try {
    res.json(await getIndividualAdvanceReport(req.params.employeeId, req.query, req.user));
  } catch (error) { next(error); }
}

export async function closedCyclesReport(req, res, next) {
  try {
    res.json(await getClosedAdvanceCyclesReport(req.user));
  } catch (error) { next(error); }
}

export async function auditReport(req, res, next) {
  try {
    res.json(await getAdvanceAuditReport(req.query, req.user));
  } catch (error) { next(error); }
}

export async function cyclesIndex(_req, res, next) {
  try {
    res.json(await listCycles());
  } catch (error) { next(error); }
}

export async function cycleStore(req, res, next) {
  try {
    res.status(201).json(await createCycle(req.user));
  } catch (error) { next(error); }
}

export async function cycleClose(req, res, next) {
  try {
    res.json(await closeCycle(req.params.id, req.body, req.user));
  } catch (error) { next(error); }
}

export async function listStore(req, res, next) {
  try {
    res.status(201).json(await createAdvanceList(req.body, req.user));
  } catch (error) { next(error); }
}

export async function listShow(req, res, next) {
  try {
    res.json(await getAdvanceList(req.params.id, req.user));
  } catch (error) { next(error); }
}

export async function listUpdate(req, res, next) {
  try {
    res.json(await updateAdvanceList(req.params.id, req.body, req.user));
  } catch (error) { next(error); }
}

export async function itemStore(req, res, next) {
  try {
    res.status(201).json(await saveAdvanceItem(req.params.id, null, req.body, req.user));
  } catch (error) { next(error); }
}

export async function itemUpdate(req, res, next) {
  try {
    res.json(await saveAdvanceItem(req.params.id, req.params.itemId, req.body, req.user));
  } catch (error) { next(error); }
}

export async function itemDestroy(req, res, next) {
  try {
    res.json(await removeAdvanceItem(req.params.id, req.params.itemId, req.user));
  } catch (error) { next(error); }
}

export async function listSubmit(req, res, next) {
  try {
    res.json(await submitAdvanceList(req.params.id, req.user));
  } catch (error) { next(error); }
}

export async function listApprove(req, res, next) {
  try {
    res.json(await approveAdvanceList(req.params.id, req.body, req.user));
  } catch (error) { next(error); }
}

export async function listSummary(req, res, next) {
  try {
    res.json(await getAdvanceSummary(req.params.id));
  } catch (error) { next(error); }
}
