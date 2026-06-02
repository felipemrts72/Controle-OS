import { Router } from 'express';
import { createSector, deactivateSector, listSectors, updateSector } from '../controllers/basicControllers.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const sectorRoutes = Router();
sectorRoutes.use(authenticate);
sectorRoutes.get('/', listSectors);
sectorRoutes.post('/', authorize('admin', 'manager'), createSector);
sectorRoutes.put('/:id', authorize('admin', 'manager'), updateSector);
sectorRoutes.patch('/:id/deactivate', authorize('admin', 'manager'), deactivateSector);
