import { Router } from 'express';
import { createOrder, deleteInternalOrder, getInternalOrder, listCustomers, listInternalOrderHistory, listInternalOrders, updateInternalOrder } from '../controllers/internalOrderController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const internalOrderRoutes = Router();
internalOrderRoutes.use(authenticate);
internalOrderRoutes.get('/', requirePermission('orders.view'), listInternalOrders);
internalOrderRoutes.get('/history', requirePermission('orders.history.view'), listInternalOrderHistory);
internalOrderRoutes.get('/customers', requirePermission('orders.view'), listCustomers);
internalOrderRoutes.post('/', requirePermission('orders.create'), createOrder);
internalOrderRoutes.get('/:id', requirePermission('orders.view'), getInternalOrder);
internalOrderRoutes.put('/:id', requirePermission('orders.edit'), updateInternalOrder);
internalOrderRoutes.delete('/:id', requirePermission('orders.delete'), deleteInternalOrder);
