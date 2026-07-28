import express, { Router } from 'express';
import { logoDestroy, logoShow, logoUpdate, show, update } from '../controllers/companySettingsController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

export const companySettingsRoutes = Router();

companySettingsRoutes.use(authenticate);
companySettingsRoutes.get('/logo', requirePermission('company_settings.view'), logoShow);
companySettingsRoutes.put(
  '/logo',
  requirePermission('company_settings.edit'),
  express.raw({ type: ['image/png', 'image/jpeg'], limit: process.env.COMPANY_LOGO_MAX_BYTES || '5mb' }),
  logoUpdate,
);
companySettingsRoutes.delete('/logo', requirePermission('company_settings.edit'), logoDestroy);
companySettingsRoutes.get('/', requirePermission('company_settings.view'), show);
companySettingsRoutes.put('/', requirePermission('company_settings.edit'), update);
