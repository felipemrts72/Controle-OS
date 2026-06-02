import { Router } from 'express';
import { login, me, register } from '../controllers/authController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

export const authRoutes = Router();
authRoutes.post('/login', login);
authRoutes.post('/register', register);
authRoutes.get('/me', authenticate, me);
