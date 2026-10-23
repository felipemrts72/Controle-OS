import express, { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';
import { cancelAbsence, changeLeave, correctConfirmedLeave, declareHistoricalEntitlement, editScheduledLeave, getEmployeeVacations, listVacationAgenda, listVacationEmployees, regularizeHistoricalLeave, reviewPeriod, saveAbsence, saveLeave } from '../services/vacationService.js';
import { archiveVacationDocument, listVacationDocuments, readVacationDocument, uploadVacationDocument, zipVacationPeriod } from '../services/vacationDocumentService.js';
import { vacationAccountingPdf } from '../services/vacationAccountingService.js';
import { sendPdfResponse } from '../services/pdf/pdfDocument.js';

export const vacationRoutes = Router();
vacationRoutes.use(authenticate);
const handle = (operation, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await operation(req)); } catch (error) { next(error); }
};
vacationRoutes.get('/', requirePermission('vacations.view'), handle((req) => listVacationEmployees(req.query)));
vacationRoutes.get('/agenda', requirePermission('vacations.view'), handle((req) => listVacationAgenda(req.query)));
vacationRoutes.get('/employees/:employeeId', requirePermission('vacations.view'), handle((req) => getEmployeeVacations(req.params.employeeId)));
vacationRoutes.post('/employees/:employeeId/absences', requirePermission('vacations.absences.create'), handle((req) => saveAbsence(req.params.employeeId, req.body, req.user.id), 201));
vacationRoutes.put('/employees/:employeeId/absences/:absenceId', requirePermission('vacations.absences.edit'), handle((req) => saveAbsence(req.params.employeeId, req.body, req.user.id, req.params.absenceId)));
vacationRoutes.delete('/employees/:employeeId/absences/:absenceId', requirePermission('vacations.correct'), handle((req) => cancelAbsence(req.params.employeeId, req.params.absenceId, req.user.id)));
vacationRoutes.post('/employees/:employeeId/periods/:periodId/review', requirePermission('vacations.review'), handle((req) => reviewPeriod(req.params.employeeId, req.params.periodId, req.body, req.user.id)));
vacationRoutes.put('/employees/:employeeId/periods/:periodId/historical-entitlement', requirePermission('vacations.review'), handle((req) => declareHistoricalEntitlement(req.params.employeeId, req.params.periodId, req.body, req.user.id)));
vacationRoutes.post('/employees/:employeeId/periods/:periodId/leaves', requirePermission('vacations.schedule'), requirePermission('vacations.review'), handle((req) => saveLeave(req.params.employeeId, req.params.periodId, req.body, req.user.id), 201));
vacationRoutes.post('/employees/:employeeId/periods/:periodId/historical-leaves', requirePermission('vacations.review'), handle((req) => regularizeHistoricalLeave(req.params.employeeId, req.params.periodId, req.body, req.user.id), 201));
vacationRoutes.post('/employees/:employeeId/leaves/:leaveId/confirm', requirePermission('vacations.confirm'), handle((req) => changeLeave(req.params.employeeId, req.params.leaveId, 'confirm', req.user.id)));
vacationRoutes.post('/employees/:employeeId/leaves/:leaveId/cancel', requirePermission('vacations.correct'), handle((req) => changeLeave(req.params.employeeId, req.params.leaveId, 'cancel', req.user.id)));
vacationRoutes.put('/employees/:employeeId/leaves/:leaveId', requirePermission('vacations.correct'), handle((req) => editScheduledLeave(req.params.employeeId, req.params.leaveId, req.body, req.user.id)));
vacationRoutes.get('/employees/:employeeId/periods/:periodId/leaves/:leaveId/accounting.pdf', requirePermission('vacations.view'), async (req,res,next) => { try { const { pdf, filename } = await vacationAccountingPdf(req.params.employeeId,req.params.periodId,req.params.leaveId,req.user.id); sendPdfResponse(res,pdf,filename); } catch(error) { next(error); } });
const documentPath = '/employees/:employeeId/periods/:periodId/leaves/:leaveId/documents';
const originalName = (value) => { try { return decodeURIComponent(value || ''); } catch { return value || ''; } };
vacationRoutes.get('/employees/:employeeId/periods/:periodId/documents.zip', requirePermission('vacations.documents.view'), async (req,res,next) => { try { const zip=await zipVacationPeriod(req.params.employeeId,req.params.periodId,req.user.id); res.set('Content-Type','application/zip').set('Content-Disposition',`attachment; filename="ferias-periodo-${req.params.periodId}.zip"`).send(zip); } catch(error) { next(error); } });
vacationRoutes.get(documentPath, requirePermission('vacations.documents.view'), handle((req) => listVacationDocuments(req.params.employeeId,req.params.periodId,req.params.leaveId)));
vacationRoutes.post(documentPath, requirePermission('vacations.documents.manage'), express.raw({ type: () => true, limit: '10mb' }), handle((req) => uploadVacationDocument(req.params.employeeId,req.params.periodId,req.params.leaveId,{ documentType:req.header('x-document-type'),originalName:originalName(req.header('x-original-name')),description:req.header('x-document-description'),mime:req.header('content-type') },req.body,req.user.id),201));
vacationRoutes.get(`${documentPath}/:documentId`, requirePermission('vacations.documents.view'), async (req,res,next) => { try { const {metadata,buffer}=await readVacationDocument(req.params.employeeId,req.params.periodId,req.params.leaveId,req.params.documentId,req.user.id); const disposition=req.query.download==='1'?'attachment':'inline'; res.set('Content-Type',metadata.mime_type).set('X-Content-Type-Options','nosniff').set('Content-Disposition',`${disposition}; filename*=UTF-8''${encodeURIComponent(metadata.original_name)}`).send(buffer); } catch(error) { next(error); } });
vacationRoutes.delete(`${documentPath}/:documentId`, requirePermission('vacations.documents.manage'), handle((req) => archiveVacationDocument(req.params.employeeId,req.params.periodId,req.params.leaveId,req.params.documentId,req.user.id)));
vacationRoutes.post('/employees/:employeeId/leaves/:leaveId/correct-confirmed', requirePermission('vacations.confirmed.correct'), handle((req) => correctConfirmedLeave(req.params.employeeId, req.params.leaveId, req.body, req.user.id)));
