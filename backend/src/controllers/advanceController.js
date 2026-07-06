import {
  approveAdvanceList,
  closeCycle,
  createAdvanceList,
  createCycle,
  getAdvanceList,
  getAdvancesHome,
  getAdvanceSummary,
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
