import { Router } from 'express';
import { createSector, deactivateSector, listSectors, reactivateSector, updateSector } from '../controllers/basicControllers.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const sectorRoutes = Router();
sectorRoutes.use(authenticate);
sectorRoutes.get('/', requireAnyPermission(
  'sectors.view',
  'products.view', 'products.create', 'products.edit',
  'orders.view', 'orders.create', 'orders.edit',
  'purchases.view', 'purchases.create_request',
  'employees.view', 'employees.create', 'employees.edit', 'employees.manage',
  'services.view', 'tv.view',
), listSectors);
sectorRoutes.post('/', requirePermission('sectors.manage'), createSector);
sectorRoutes.put('/:id', requirePermission('sectors.manage'), updateSector);
sectorRoutes.patch('/:id/deactivate', requirePermission('sectors.manage'), deactivateSector);
sectorRoutes.patch('/:id/reactivate', requirePermission('sectors.manage'), reactivateSector);
