import { Router } from 'express';
import { auditShipping, confirmByCode, confirmSale, listReadyForShipping, lookupByCode, lookupBySale } from '../controllers/shippingController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const shippingRoutes = Router();
shippingRoutes.use(authenticate);
shippingRoutes.get('/audit', requirePermission('shipping.audit.view'), auditShipping);
shippingRoutes.get('/ready', requirePermission('shipping.ready_admin.view'), listReadyForShipping);
shippingRoutes.get('/code/:shipmentCode', requirePermission('shipping.view'), lookupByCode);
shippingRoutes.post('/code/:shipmentCode/confirm', requirePermission('shipping.confirm'), confirmByCode);
shippingRoutes.get('/sale/:saleNumber', requirePermission('shipping.view'), lookupBySale);
shippingRoutes.post('/sale/:saleNumber/confirm-all', requirePermission('shipping.confirm'), confirmSale);
