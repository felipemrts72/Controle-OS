import { Router } from 'express';
import { listServices } from '../controllers/serviceController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const serviceRoutes = Router();

serviceRoutes.use(authenticate);
serviceRoutes.get('/', authorize('admin', 'manager', 'viewer'), listServices);
