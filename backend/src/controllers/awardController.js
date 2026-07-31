import {
  createAward,
  deleteAward,
  getAward,
  getAwardForPdf,
  listAwardEmployees,
  listAwards,
  updateAward,
} from '../services/awardService.js';
import { getCompanyPdfData } from '../services/companySettingsService.js';
import { buildAwardTermPdf } from '../services/pdf/awardPdfService.js';
import { sendPdfResponse } from '../services/pdf/pdfDocument.js';

export async function index(req, res, next) {
  try {
    res.json(await listAwards(req.query));
  } catch (error) { next(error); }
}

export async function employees(req, res, next) {
  try {
    res.json(await listAwardEmployees(req.query.search));
  } catch (error) { next(error); }
}

export async function show(req, res, next) {
  try {
    res.json(await getAward(req.params.id));
  } catch (error) { next(error); }
}

export async function store(req, res, next) {
  try {
    res.status(201).json(await createAward(req.body, req.user));
  } catch (error) { next(error); }
}

export async function update(req, res, next) {
  try {
    res.json(await updateAward(req.params.id, req.body, req.user));
  } catch (error) { next(error); }
}

export async function destroy(req, res, next) {
  try {
    res.json(await deleteAward(req.params.id, req.user));
  } catch (error) { next(error); }
}

export async function pdf(req, res, next) {
  try {
    const [award, company] = await Promise.all([
      getAwardForPdf(req.params.id, req.user),
      getCompanyPdfData(),
    ]);
    const document = await buildAwardTermPdf(award, { company });
    const awardDate = award.award_date instanceof Date
      ? award.award_date.toISOString().slice(0, 10)
      : String(award.award_date || '').slice(0, 10);
    sendPdfResponse(
      res,
      document,
      `termo-premio-${award.employee_name_snapshot}-${awardDate}.pdf`,
    );
  } catch (error) { next(error); }
}
