import { Router } from 'express';
import { approveUser, changeUserPassword, createUser, listUsers, rejectUser, toggleUserActive, updateUserRole } from '../controllers/userController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const userRoutes = Router();
userRoutes.use(authenticate);
userRoutes.get('/', requirePermission('users.view'), listUsers);
userRoutes.post('/', requirePermission('users.manage'), createUser);
userRoutes.patch('/:id/approve', requireAnyPermission('users.approve', 'users.manage'), approveUser);
userRoutes.patch('/:id/reject', requirePermission('users.manage'), rejectUser);
userRoutes.patch('/:id/role', requirePermission('users.manage'), updateUserRole);
userRoutes.patch('/:id/toggle-active', requirePermission('users.manage'), toggleUserActive);
userRoutes.patch('/:id/password', changeUserPassword);
