import { Router } from 'express';
import {
  cycleClose,
  cyclesIndex,
  cycleStore,
  auditReport,
  employees,
  closedCyclesReport,
  eligibleInstallments,
  generalReport,
  home,
  individualStore,
  individualReport,
  installmentConvert,
  itemDestroy,
  itemStore,
  itemUpdate,
  limitLookup,
  listApprove,
  listShow,
  listStore,
  listSubmit,
  listSummary,
  listUpdate,
} from '../controllers/advanceController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const advanceRoutes = Router();

advanceRoutes.use(authenticate);

advanceRoutes.get('/', requirePermission('advances.view'), home);
advanceRoutes.get('/employees', requireAnyPermission('advances.create', 'advances.review', 'advances.create_individual', 'advances.installments.convert', 'advances.reports.individual', 'advances.manage'), employees);
advanceRoutes.get('/limit-lookup', requireAnyPermission('advances.limit_lookup', 'advances.manage'), limitLookup);
advanceRoutes.post('/individual', requireAnyPermission('advances.create_individual', 'advances.manage'), individualStore);
advanceRoutes.get('/installments/eligible', requireAnyPermission('advances.installments.convert', 'advances.manage'), eligibleInstallments);
advanceRoutes.post('/individual/:itemId/installments', requireAnyPermission('advances.installments.convert', 'advances.manage'), installmentConvert);
advanceRoutes.get('/reports/general', requireAnyPermission('advances.reports.general', 'advances.manage'), generalReport);
advanceRoutes.get('/reports/individual/:employeeId', requireAnyPermission('advances.reports.individual', 'advances.manage'), individualReport);
advanceRoutes.get('/reports/cycles', requireAnyPermission('advances.reports.cycles', 'advances.manage'), closedCyclesReport);
advanceRoutes.get('/audit', requireAnyPermission('advances.audit.view', 'advances.manage'), auditReport);
advanceRoutes.get('/cycles', requireAnyPermission('advances.cycles.view', 'advances.view'), cyclesIndex);
advanceRoutes.post('/cycles', requireAnyPermission('advances.cycles.create', 'advances.manage'), cycleStore);
advanceRoutes.post('/cycles/:id/close', requireAnyPermission('advances.cycles.close', 'advances.manage'), cycleClose);

advanceRoutes.post('/lists', requireAnyPermission('advances.create', 'advances.manage'), listStore);
advanceRoutes.get('/lists/:id', requirePermission('advances.view'), listShow);
advanceRoutes.put('/lists/:id', requireAnyPermission('advances.edit_own_list', 'advances.review', 'advances.manage'), listUpdate);
advanceRoutes.post('/lists/:id/items', requireAnyPermission('advances.create', 'advances.review', 'advances.manage'), itemStore);
advanceRoutes.put('/lists/:id/items/:itemId', requireAnyPermission('advances.edit_own_list', 'advances.review', 'advances.manage'), itemUpdate);
advanceRoutes.delete('/lists/:id/items/:itemId', requireAnyPermission('advances.review', 'advances.manage'), itemDestroy);
advanceRoutes.post('/lists/:id/submit', requireAnyPermission('advances.create', 'advances.edit_own_list', 'advances.review', 'advances.manage'), listSubmit);
advanceRoutes.post('/lists/:id/approve', requireAnyPermission('advances.approve', 'advances.manage'), listApprove);
advanceRoutes.get('/lists/:id/summary', requirePermission('advances.view'), listSummary);
