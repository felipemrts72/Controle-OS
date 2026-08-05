import { Router } from 'express';
import { downloadLabelPdf, downloadSoldItemLabelPdf, generateLabel, generateSoldItemLabelRecords, listLabelQueue, markWithoutLabel, updateOrderInvoiceNumber } from '../controllers/labelController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const labelRoutes = Router();
labelRoutes.use(authenticate);
labelRoutes.get('/sold-item/:soldItemId/pdf', requireAnyPermission('labels.print', 'labels.reprint'), downloadSoldItemLabelPdf);
labelRoutes.post('/sold-item/:soldItemId/generate', requirePermission('labels.print'), generateSoldItemLabelRecords);
labelRoutes.patch('/internal-order/:internalOrderId/invoice', requirePermission('labels.print'), updateOrderInvoiceNumber);
labelRoutes.post('/:shipmentVolumeId/generate', requirePermission('labels.print'), generateLabel);
labelRoutes.post('/:shipmentVolumeId/without-label', requirePermission('labels.mark_without_label'), markWithoutLabel);
labelRoutes.get('/:shipmentVolumeId/pdf', requireAnyPermission('labels.print', 'labels.reprint'), downloadLabelPdf);
labelRoutes.get('/queue', requirePermission('labels.view'), listLabelQueue);
