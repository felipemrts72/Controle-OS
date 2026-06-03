import { Router } from 'express';
import { auditShipping, confirmByCode, confirmSale, lookupByCode, lookupBySale } from '../controllers/shippingController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const shippingRoutes = Router();
shippingRoutes.use(authenticate, authorize('admin', 'manager', 'shipping'));
shippingRoutes.get('/audit', authorize('admin', 'manager'), auditShipping);
shippingRoutes.get('/code/:shipmentCode', lookupByCode);
shippingRoutes.post('/code/:shipmentCode/confirm', confirmByCode);
shippingRoutes.get('/sale/:saleNumber', lookupBySale);
shippingRoutes.post('/sale/:saleNumber/confirm-all', confirmSale);
