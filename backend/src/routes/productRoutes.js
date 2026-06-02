import { Router } from 'express';
import { getProduct, listProducts, saveProduct, searchProducts } from '../controllers/basicControllers.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const productRoutes = Router();
productRoutes.use(authenticate);
productRoutes.get('/', listProducts);
productRoutes.get('/search', searchProducts);
productRoutes.post('/', authorize('admin', 'manager'), saveProduct);
productRoutes.get('/:id', getProduct);
productRoutes.put('/:id', authorize('admin', 'manager'), saveProduct);
