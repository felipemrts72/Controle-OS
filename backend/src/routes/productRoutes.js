import { Router } from 'express';
import { deleteProduct, getProduct, listProducts, listProductTypes, saveProduct, saveProductType, searchProducts } from '../controllers/basicControllers.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const productRoutes = Router();
productRoutes.use(authenticate);
productRoutes.get('/types', listProductTypes);
productRoutes.post('/types', authorize('admin', 'manager'), saveProductType);
productRoutes.put('/types/:id', authorize('admin', 'manager'), saveProductType);
productRoutes.get('/', listProducts);
productRoutes.get('/search', searchProducts);
productRoutes.post('/', authorize('admin', 'manager'), saveProduct);
productRoutes.get('/:id', getProduct);
productRoutes.put('/:id', authorize('admin', 'manager'), saveProduct);
productRoutes.delete('/:id', authorize('admin', 'manager'), deleteProduct);
