import { Router } from 'express';
import { createOrder, getInternalOrder, listInternalOrders, updateInternalOrder } from '../controllers/internalOrderController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const internalOrderRoutes = Router();
internalOrderRoutes.use(authenticate);
internalOrderRoutes.get('/', listInternalOrders);
internalOrderRoutes.post('/', authorize('admin', 'manager'), createOrder);
internalOrderRoutes.get('/:id', getInternalOrder);
internalOrderRoutes.put('/:id', authorize('admin', 'manager'), updateInternalOrder);
