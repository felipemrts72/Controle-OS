import { Router } from 'express';
import { authenticate, requireAnyPermission } from '../middlewares/authMiddleware.js';
import { listMeasurementUnits } from '../services/measurementUnitService.js';

export const measurementUnitRoutes = Router();
measurementUnitRoutes.use(authenticate);
measurementUnitRoutes.get('/', requireAnyPermission(
  'products.view', 'products.create', 'products.edit',
  'purchases.view', 'purchases.create_request', 'purchases.create_direct',
  'purchase_quotes.create', 'purchase_items.import', 'supplier_catalog.view', 'supplier_catalog.manage',
  'purchase_imports.create_product',
), async (req, res, next) => {
  try { res.json(await listMeasurementUnits(req.query)); } catch (error) { next(error); }
});
