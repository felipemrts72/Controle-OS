import { Router } from 'express';
import { approveUser, createUser, listUsers, rejectUser, toggleUserActive, updateUserRole } from '../controllers/basicControllers.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const userRoutes = Router();
userRoutes.use(authenticate, authorize('admin'));
userRoutes.get('/', listUsers);
userRoutes.post('/', createUser);
userRoutes.patch('/:id/approve', approveUser);
userRoutes.patch('/:id/reject', rejectUser);
userRoutes.patch('/:id/role', updateUserRole);
userRoutes.patch('/:id/toggle-active', toggleUserActive);
