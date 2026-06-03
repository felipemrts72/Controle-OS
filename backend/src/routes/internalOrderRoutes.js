import { Router } from 'express';
import { createOrder, deleteInternalOrder, getInternalOrder, listInternalOrderHistory, listInternalOrders, updateInternalOrder } from '../controllers/internalOrderController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const internalOrderRoutes = Router();
internalOrderRoutes.use(authenticate);
internalOrderRoutes.get('/', authorize('admin', 'manager'), listInternalOrders);
internalOrderRoutes.get('/history', authorize('admin'), listInternalOrderHistory);
internalOrderRoutes.post('/', authorize('admin', 'manager'), createOrder);
internalOrderRoutes.get('/:id', authorize('admin', 'manager'), getInternalOrder);
internalOrderRoutes.put('/:id', authorize('admin', 'manager'), updateInternalOrder);
internalOrderRoutes.delete('/:id', authorize('admin', 'manager'), deleteInternalOrder);
