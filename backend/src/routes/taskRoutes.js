import { Router } from 'express';
import { listTasksBySector, setTaskStatus } from '../controllers/taskController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const taskRoutes = Router();
taskRoutes.use(authenticate);
taskRoutes.patch('/:id/ready', authorize('admin', 'manager'), setTaskStatus);
taskRoutes.patch('/:id/pending', authorize('admin', 'manager'), setTaskStatus);
taskRoutes.get('/sector/:sectorId', listTasksBySector);
