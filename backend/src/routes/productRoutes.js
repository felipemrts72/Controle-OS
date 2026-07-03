import { Router } from 'express';
import { deleteProduct, getProduct, listProducts, listProductTypes, saveProduct, saveProductType, searchProducts } from '../controllers/basicControllers.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const productRoutes = Router();
productRoutes.use(authenticate);
productRoutes.get('/types', requirePermission('products.view'), listProductTypes);
productRoutes.post('/types', requirePermission('products.types.manage'), saveProductType);
productRoutes.put('/types/:id', requirePermission('products.types.manage'), saveProductType);
productRoutes.get('/', requirePermission('products.view'), listProducts);
productRoutes.get('/search', requirePermission('products.view'), searchProducts);
productRoutes.post('/', requirePermission('products.create'), saveProduct);
productRoutes.get('/:id', requirePermission('products.view'), getProduct);
productRoutes.put('/:id', requirePermission('products.edit'), saveProduct);
productRoutes.delete('/:id', requirePermission('products.delete'), deleteProduct);
