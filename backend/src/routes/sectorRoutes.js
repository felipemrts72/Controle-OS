import { Router } from 'express';
import { createSector, deactivateSector, listSectors, reactivateSector, updateSector } from '../controllers/basicControllers.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const sectorRoutes = Router();
sectorRoutes.use(authenticate);
sectorRoutes.get('/', requireAnyPermission('sectors.view', 'employees.view', 'employees.create', 'employees.edit', 'employees.manage'), listSectors);
sectorRoutes.post('/', requirePermission('sectors.manage'), createSector);
sectorRoutes.put('/:id', requirePermission('sectors.manage'), updateSector);
sectorRoutes.patch('/:id/deactivate', requirePermission('sectors.manage'), deactivateSector);
sectorRoutes.patch('/:id/reactivate', requirePermission('sectors.manage'), reactivateSector);
