import { Router } from 'express';
import { index, show } from '../controllers/commercialSaleController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const commercialSaleRoutes = Router();
commercialSaleRoutes.use(authenticate, requirePermission('commercial.sales.view'));
commercialSaleRoutes.get('/', index);
commercialSaleRoutes.get('/:id', show);
