import { Router } from 'express';
import { downloadLabelPdf, generateLabel, listLabelQueue, markWithoutLabel } from '../controllers/labelController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const labelRoutes = Router();
labelRoutes.use(authenticate);
labelRoutes.post('/:shipmentVolumeId/generate', authorize('admin', 'manager'), generateLabel);
labelRoutes.post('/:shipmentVolumeId/without-label', authorize('admin', 'manager'), markWithoutLabel);
labelRoutes.get('/:shipmentVolumeId/pdf', authorize('admin', 'manager', 'shipping'), downloadLabelPdf);
labelRoutes.get('/queue', listLabelQueue);
