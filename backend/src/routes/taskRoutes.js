import { Router } from 'express';
import { listTasksBySector, pinTask, setTaskStatus, unpinTask } from '../controllers/taskController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const taskRoutes = Router();
taskRoutes.use(authenticate);
taskRoutes.patch('/:id/ready', authorize('admin', 'manager'), setTaskStatus);
taskRoutes.patch('/:id/pending', authorize('admin', 'manager'), setTaskStatus);
taskRoutes.patch('/:id/pin', authorize('admin', 'manager', 'viewer'), pinTask);
taskRoutes.patch('/:id/unpin', authorize('admin', 'manager', 'viewer'), unpinTask);
taskRoutes.get('/sector/:sectorId', listTasksBySector);
