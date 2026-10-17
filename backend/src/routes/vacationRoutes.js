import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';
import { cancelAbsence, changeLeave, correctConfirmedLeave, getEmployeeVacations, listVacationEmployees, regularizeHistoricalLeave, reviewPeriod, saveAbsence, saveLeave } from '../services/vacationService.js';

export const vacationRoutes = Router();
vacationRoutes.use(authenticate);
const handle = (operation, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await operation(req)); } catch (error) { next(error); }
};
vacationRoutes.get('/', requirePermission('vacations.view'), handle((req) => listVacationEmployees(req.query.search)));
vacationRoutes.get('/employees/:employeeId', requirePermission('vacations.view'), handle((req) => getEmployeeVacations(req.params.employeeId)));
vacationRoutes.post('/employees/:employeeId/absences', requirePermission('vacations.absences.create'), handle((req) => saveAbsence(req.params.employeeId, req.body, req.user.id), 201));
vacationRoutes.put('/employees/:employeeId/absences/:absenceId', requirePermission('vacations.absences.edit'), handle((req) => saveAbsence(req.params.employeeId, req.body, req.user.id, req.params.absenceId)));
vacationRoutes.delete('/employees/:employeeId/absences/:absenceId', requirePermission('vacations.correct'), handle((req) => cancelAbsence(req.params.employeeId, req.params.absenceId, req.user.id)));
vacationRoutes.post('/employees/:employeeId/periods/:periodId/review', requirePermission('vacations.review'), handle((req) => reviewPeriod(req.params.employeeId, req.params.periodId, req.body, req.user.id)));
vacationRoutes.post('/employees/:employeeId/periods/:periodId/leaves', requirePermission('vacations.schedule'), requirePermission('vacations.review'), handle((req) => saveLeave(req.params.employeeId, req.params.periodId, req.body, req.user.id), 201));
vacationRoutes.post('/employees/:employeeId/periods/:periodId/historical-leaves', requirePermission('vacations.review'), handle((req) => regularizeHistoricalLeave(req.params.employeeId, req.params.periodId, req.body, req.user.id), 201));
vacationRoutes.post('/employees/:employeeId/leaves/:leaveId/confirm', requirePermission('vacations.confirm'), handle((req) => changeLeave(req.params.employeeId, req.params.leaveId, 'confirm', req.user.id)));
vacationRoutes.post('/employees/:employeeId/leaves/:leaveId/cancel', requirePermission('vacations.correct'), handle((req) => changeLeave(req.params.employeeId, req.params.leaveId, 'cancel', req.user.id)));
vacationRoutes.post('/employees/:employeeId/leaves/:leaveId/correct-confirmed', requirePermission('vacations.confirmed.correct'), handle((req) => correctConfirmedLeave(req.params.employeeId, req.params.leaveId, req.body, req.user.id)));
