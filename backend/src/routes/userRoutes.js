import { Router } from 'express';
import { createUser, listUsers } from '../controllers/basicControllers.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

export const userRoutes = Router();
userRoutes.use(authenticate, authorize('admin'));
userRoutes.get('/', listUsers);
userRoutes.post('/', createUser);
