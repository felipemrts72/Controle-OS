import express, { Router } from 'express';
import {
  auditIndex,
  completeProfile,
  dependentDestroy,
  dependentStore,
  dependentUpdate,
  dependentsIndex,
  documentDestroy,
  documentShow,
  documentStore,
  documentsIndex,
  index,
  mealAllowanceHistory,
  mealAllowanceStore,
  printData,
  quickStore,
  salaryHistory,
  salaryStore,
  show,
  store,
  update,
  updateStatus,
} from '../controllers/employeeController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const employeeRoutes = Router();

employeeRoutes.use(authenticate);

employeeRoutes.get('/', requirePermission('employees.view'), index);
employeeRoutes.post('/', requirePermission('employees.create'), store);
employeeRoutes.post('/quick', requirePermission('employees.create'), quickStore);
employeeRoutes.get('/:id', requirePermission('employees.view'), show);
employeeRoutes.put('/:id', requireAnyPermission('employees.edit', 'employees.manage'), update);
employeeRoutes.post('/:id/complete-profile', requireAnyPermission('employees.create', 'employees.edit', 'employees.manage'), completeProfile);
employeeRoutes.patch('/:id/status', requireAnyPermission('employees.deactivate', 'employees.edit', 'employees.manage'), updateStatus);

employeeRoutes.get('/:id/salary-history', requirePermission('employees.salary.view'), salaryHistory);
employeeRoutes.post('/:id/salary', requireAnyPermission('employees.salary.manage', 'employees.manage'), salaryStore);
employeeRoutes.get('/:id/meal-allowance-history', requirePermission('employees.meal_allowance.view'), mealAllowanceHistory);
employeeRoutes.post('/:id/meal-allowance', requireAnyPermission('employees.meal_allowance.manage', 'employees.manage'), mealAllowanceStore);

employeeRoutes.get('/:id/dependents', requirePermission('employees.dependents.view'), dependentsIndex);
employeeRoutes.post('/:id/dependents', requireAnyPermission('employees.dependents.manage', 'employees.manage'), dependentStore);
employeeRoutes.put('/:id/dependents/:dependentId', requireAnyPermission('employees.dependents.manage', 'employees.manage'), dependentUpdate);
employeeRoutes.delete('/:id/dependents/:dependentId', requireAnyPermission('employees.dependents.manage', 'employees.manage'), dependentDestroy);

employeeRoutes.get('/:id/documents', requirePermission('employees.documents.view'), documentsIndex);
employeeRoutes.post(
  '/:id/documents',
  requireAnyPermission('employees.create', 'employees.documents.manage', 'employees.manage'),
  express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: process.env.EMPLOYEE_DOCUMENT_MAX_BYTES || '10mb' }),
  documentStore,
);
employeeRoutes.get('/:id/documents/:documentId', requirePermission('employees.documents.view'), documentShow);
employeeRoutes.delete('/:id/documents/:documentId', requireAnyPermission('employees.documents.manage', 'employees.manage'), documentDestroy);

employeeRoutes.get('/:id/profile-print-data', requirePermission('employees.profile.print'), printData);
employeeRoutes.get('/:id/audit', requireAnyPermission('employees.edit', 'employees.manage'), auditIndex);
