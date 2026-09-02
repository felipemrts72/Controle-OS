import { Router } from 'express';
import { index, show, store, update, updateActive } from '../controllers/customerController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const customerRoutes = Router();

customerRoutes.use(authenticate);
customerRoutes.get('/', requirePermission('commercial.customers.view'), index);
customerRoutes.post('/', requirePermission('commercial.customers.create'), store);
customerRoutes.get('/:id', requirePermission('commercial.customers.view'), show);
customerRoutes.put('/:id', requirePermission('commercial.customers.edit'), update);
customerRoutes.patch('/:id/active', requirePermission('commercial.customers.edit'), updateActive);
