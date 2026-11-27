import { Router } from 'express';
import * as controller from '../controllers/commercialQuoteController.js';
import * as manufacturing from '../controllers/quoteManufacturingController.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const commercialQuoteRoutes = Router();

commercialQuoteRoutes.use(authenticate);
const planPermission = requireAnyPermission('commercial.quotes.create','commercial.quotes.edit');
commercialQuoteRoutes.post('/manufacturing/template', planPermission, manufacturing.template);
commercialQuoteRoutes.get('/manufacturing/types', planPermission, manufacturing.types);
commercialQuoteRoutes.get('/manufacturing/units', planPermission, manufacturing.units);
commercialQuoteRoutes.get('/manufacturing/sectors', planPermission, manufacturing.sectors);
commercialQuoteRoutes.get('/manufacturing/products', planPermission, manufacturing.products);
commercialQuoteRoutes.get('/manufacturing/products/:productId/tree', planPermission, manufacturing.tree);
commercialQuoteRoutes.post('/:id/manufacturing/correct-names', requirePermission('commercial.quotes.edit'), requirePermission('orders.edit'), manufacturing.correctNames);
commercialQuoteRoutes.put('/:id/manufacturing', requirePermission('commercial.quotes.edit'), manufacturing.saveApproved);
commercialQuoteRoutes.get('/:id/manufacturing', requirePermission('commercial.quotes.view'), manufacturing.review);
commercialQuoteRoutes.post('/:id/manufacturing/issue', requirePermission('commercial.quotes.approve'), manufacturing.issue);
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
commercialQuoteRoutes.post('/:id/emit', requirePermission('commercial.quotes.edit'), controller.emit);
commercialQuoteRoutes.patch(
  '/:id/status',
  requireAnyPermission('commercial.quotes.edit', 'commercial.quotes.approve', 'commercial.quotes.cancel'),
  controller.updateStatus,
);
