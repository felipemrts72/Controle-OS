import { Router } from 'express';
import { deleteProduct, getProduct, listProducts, listProductTypes, saveProduct, saveProductType, searchProducts } from '../controllers/basicControllers.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';

export const productRoutes = Router();
productRoutes.use(authenticate);
productRoutes.get('/types', requireAnyPermission('products.view', 'products.create', 'products.edit', 'products.types.manage'), listProductTypes);
productRoutes.post('/types', requirePermission('products.types.manage'), saveProductType);
productRoutes.put('/types/:id', requirePermission('products.types.manage'), saveProductType);
productRoutes.get('/', requirePermission('products.view'), listProducts);
productRoutes.get('/search', requireAnyPermission('products.view', 'products.create', 'products.edit'), searchProducts);
productRoutes.post('/', requirePermission('products.create'), saveProduct);
productRoutes.get('/:id', requireAnyPermission('products.view', 'products.edit'), getProduct);
productRoutes.put('/:id', requirePermission('products.edit'), saveProduct);
productRoutes.delete('/:id', requirePermission('products.delete'), deleteProduct);
