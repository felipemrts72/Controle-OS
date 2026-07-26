import { Router } from 'express';
import { listTasksBySector, pinTask, setTaskStatus, unpinTask } from '../controllers/taskController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const taskRoutes = Router();
taskRoutes.use(authenticate);
taskRoutes.patch('/:id/ready', requirePermission('services.complete'), setTaskStatus);
taskRoutes.patch('/:id/pending', requirePermission('services.complete'), setTaskStatus);
taskRoutes.patch('/:id/pin', requirePermission('tv.view'), pinTask);
taskRoutes.patch('/:id/unpin', requirePermission('tv.view'), unpinTask);
taskRoutes.get('/sector/:sectorId', requirePermission('tv.view'), listTasksBySector);
