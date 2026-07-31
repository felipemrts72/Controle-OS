import { Router } from 'express';
import { destroy, employees, index, pdf, show, store, update } from '../controllers/awardController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const awardRoutes = Router();

awardRoutes.use(authenticate);
awardRoutes.get('/', requirePermission('awards.view'), index);
awardRoutes.get('/employees', requireAnyPermission('awards.create', 'awards.edit'), employees);
awardRoutes.get('/:id/pdf', requirePermission('awards.pdf'), pdf);
awardRoutes.get('/:id', requirePermission('awards.view'), show);
awardRoutes.post('/', requirePermission('awards.create'), store);
awardRoutes.put('/:id', requirePermission('awards.edit'), update);
awardRoutes.delete('/:id', requirePermission('awards.delete'), destroy);
