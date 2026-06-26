import { Router } from 'express';
import { downloadLabelPdf, downloadSoldItemLabelPdf, generateLabel, listLabelQueue, markWithoutLabel, updateOrderInvoiceNumber } from '../controllers/labelController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const labelRoutes = Router();
labelRoutes.use(authenticate);
labelRoutes.get('/sold-item/:soldItemId/pdf', authorize('admin', 'manager', 'shipping'), downloadSoldItemLabelPdf);
labelRoutes.patch('/internal-order/:internalOrderId/invoice', authorize('admin', 'manager', 'shipping'), updateOrderInvoiceNumber);
labelRoutes.post('/:shipmentVolumeId/generate', authorize('admin', 'manager'), generateLabel);
labelRoutes.post('/:shipmentVolumeId/without-label', authorize('admin', 'manager'), markWithoutLabel);
labelRoutes.get('/:shipmentVolumeId/pdf', authorize('admin', 'manager', 'shipping'), downloadLabelPdf);
labelRoutes.get('/queue', listLabelQueue);
