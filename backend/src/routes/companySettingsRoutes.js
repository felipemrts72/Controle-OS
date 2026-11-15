import express, { Router } from 'express';
import { logoDestroy, logoShow, logoUpdate, show, signatureDestroy, signatureShow, signatureUpdate, update } from '../controllers/companySettingsController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

import { configureMaster, listExceptions, masterStatus } from '../services/administrativeExceptionService.js';

const security = (operation) => async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await operation(req)); } catch (error) { next(error); }
};

export const companySettingsRoutes = Router();

companySettingsRoutes.use(authenticate);
companySettingsRoutes.get('/security/master-password', security((req) => masterStatus(req.user)));
companySettingsRoutes.put('/security/master-password', security((req) => configureMaster(req.user, req.body)));
companySettingsRoutes.get('/security/exceptions', security((req) => listExceptions(req.user, req.query.before)));
companySettingsRoutes.get('/logo', requirePermission('company_settings.view'), logoShow);
companySettingsRoutes.put(
  '/logo',
  requirePermission('company_settings.edit'),
  express.raw({ type: ['image/png', 'image/jpeg'], limit: process.env.COMPANY_LOGO_MAX_BYTES || '5mb' }),
  logoUpdate,
);
companySettingsRoutes.delete('/logo', requirePermission('company_settings.edit'), logoDestroy);
companySettingsRoutes.get('/signature', requirePermission('company_settings.view'), signatureShow);
companySettingsRoutes.put(
  '/signature',
  requirePermission('company_settings.edit'),
  express.raw({ type: ['image/png', 'image/jpeg'], limit: '5mb' }),
  signatureUpdate,
);
companySettingsRoutes.delete('/signature', requirePermission('company_settings.edit'), signatureDestroy);
companySettingsRoutes.get('/', requirePermission('company_settings.view'), show);
companySettingsRoutes.put('/', requirePermission('company_settings.edit'), update);
