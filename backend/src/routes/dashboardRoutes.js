import { Router } from 'express';
import { dashboard, tvBySector } from '../controllers/dashboardController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

export const dashboardRoutes = Router();
dashboardRoutes.get('/dashboard', authenticate, dashboard);
dashboardRoutes.get('/tv/:sectorId', tvBySector);
