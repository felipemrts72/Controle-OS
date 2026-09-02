import { Router } from 'express';
import * as controller from '../controllers/commercialQuoteController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const commercialQuoteRoutes = Router();

commercialQuoteRoutes.use(authenticate);
commercialQuoteRoutes.get('/products', requireAnyPermission('commercial.quotes.create', 'commercial.quotes.edit'), controller.products);
commercialQuoteRoutes.get('/customers', requireAnyPermission('commercial.quotes.create', 'commercial.quotes.edit'), controller.customers);
commercialQuoteRoutes.get('/', requirePermission('commercial.quotes.view'), controller.index);
commercialQuoteRoutes.post('/', requirePermission('commercial.quotes.create'), controller.store);
commercialQuoteRoutes.get('/legacy/:id/pdf', requirePermission('commercial.quotes.view'), controller.legacyPdf);
commercialQuoteRoutes.get('/legacy/:id', requirePermission('commercial.quotes.view'), controller.showLegacy);
commercialQuoteRoutes.post('/legacy/:id/duplicate', requirePermission('commercial.quotes.create'), controller.duplicateLegacy);
commercialQuoteRoutes.get('/:id/pdf', requirePermission('commercial.quotes.view'), controller.pdf);
commercialQuoteRoutes.get('/:id', requirePermission('commercial.quotes.view'), controller.show);
commercialQuoteRoutes.put('/:id', requirePermission('commercial.quotes.edit'), controller.update);
commercialQuoteRoutes.post('/:id/duplicate', requirePermission('commercial.quotes.create'), controller.duplicate);
commercialQuoteRoutes.patch(
  '/:id/status',
  requireAnyPermission('commercial.quotes.edit', 'commercial.quotes.approve', 'commercial.quotes.cancel'),
  controller.updateStatus,
);
