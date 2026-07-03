import { Router } from 'express';
import { dashboard, tvBySector, tvPanel } from '../controllers/dashboardController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const dashboardRoutes = Router();
dashboardRoutes.get('/dashboard', authenticate, requirePermission('dashboard.view'), dashboard);
dashboardRoutes.get('/tv', authenticate, requirePermission('tv.view'), tvPanel);
dashboardRoutes.get('/tv/:sectorId', authenticate, requirePermission('tv.view'), tvBySector);
