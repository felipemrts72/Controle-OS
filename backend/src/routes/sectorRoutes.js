import { Router } from 'express';
import { createSector, deactivateSector, listSectors, updateSector } from '../controllers/basicControllers.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const sectorRoutes = Router();
sectorRoutes.use(authenticate);
sectorRoutes.get('/', requirePermission('sectors.view'), listSectors);
sectorRoutes.post('/', requirePermission('sectors.manage'), createSector);
sectorRoutes.put('/:id', requirePermission('sectors.manage'), updateSector);
sectorRoutes.patch('/:id/deactivate', requirePermission('sectors.manage'), deactivateSector);
