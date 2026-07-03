import { Router } from 'express';
import { listServices } from '../controllers/serviceController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const serviceRoutes = Router();

serviceRoutes.use(authenticate);
serviceRoutes.get('/', requirePermission('services.view'), listServices);
