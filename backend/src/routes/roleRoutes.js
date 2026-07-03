import { Router } from 'express';
import { createRole, listPermissions, listRoles, updateRole } from '../controllers/roleController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const roleRoutes = Router();

roleRoutes.use(authenticate);
roleRoutes.get('/permissions', requirePermission('roles.view'), listPermissions);
roleRoutes.get('/', requirePermission('roles.view'), listRoles);
roleRoutes.post('/', requirePermission('roles.manage'), createRole);
roleRoutes.put('/:id', requirePermission('roles.manage'), updateRole);
