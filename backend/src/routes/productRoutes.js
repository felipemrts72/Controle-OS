import express, { Router } from 'express';
import { deleteProduct, getProduct, listProducts, listProductTypes, saveProduct, saveProductType, searchProducts } from '../controllers/basicControllers.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/authMiddleware.js';
import { remove as removeProductImage, show as showProductImage, upload as uploadProductImage } from '../controllers/productImageController.js';

export const productRoutes = Router();
productRoutes.use(authenticate);
productRoutes.get('/types', requireAnyPermission('products.view', 'products.create', 'products.edit', 'products.types.manage'), listProductTypes);
productRoutes.post('/types', requirePermission('products.types.manage'), saveProductType);
productRoutes.put('/types/:id', requirePermission('products.types.manage'), saveProductType);
productRoutes.get('/', requirePermission('products.view'), listProducts);
productRoutes.get('/search', requireAnyPermission('products.view', 'products.create', 'products.edit'), searchProducts);
productRoutes.get('/:id/photo', requireAnyPermission('products.view','products.create','products.edit','purchases.view','purchases.create_request','purchase_quotes.create','purchase_imports.create_product'), showProductImage);
productRoutes.put('/:id/photo', requireAnyPermission('products.create','products.edit','purchase_imports.create_product'), express.raw({type:['image/png','image/jpeg'],limit:process.env.PRODUCT_IMAGE_MAX_BYTES||'5mb'}), uploadProductImage);
productRoutes.delete('/:id/photo', requireAnyPermission('products.edit','purchase_imports.create_product'), removeProductImage);
productRoutes.post('/', requirePermission('products.create'), saveProduct);
productRoutes.get('/:id', requireAnyPermission('products.view', 'products.edit'), getProduct);
productRoutes.put('/:id', requirePermission('products.edit'), saveProduct);
productRoutes.delete('/:id', requirePermission('products.delete'), deleteProduct);
