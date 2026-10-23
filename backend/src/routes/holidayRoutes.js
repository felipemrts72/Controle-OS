import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';
import { httpError } from '../utils/httpError.js';
import { holidayOn, listHolidayRules, saveHolidayRule } from '../services/holidayService.js';

export const holidayRoutes = Router();
holidayRoutes.use(authenticate);
const admin = (req, _res, next) => (req.user.role_slug || req.user.role) === 'admin' ? next() : next(httpError(403, 'Somente ADMIN pode alterar feriados.'));
holidayRoutes.get('/', requirePermission('vacations.view'), async (req,res,next) => { try { res.json(await listHolidayRules(req.query.year)); } catch (error) { next(error); } });
holidayRoutes.get('/on/:date', requirePermission('vacations.view'), async (req,res,next) => { try { res.json(await holidayOn(req.params.date)); } catch (error) { next(error); } });
holidayRoutes.post('/', admin, async (req,res,next) => { try { res.status(201).json(await saveHolidayRule(req.body)); } catch (error) { next(error); } });
holidayRoutes.put('/:id', admin, async (req,res,next) => { try { res.json(await saveHolidayRule(req.body,req.params.id)); } catch (error) { next(error); } });
