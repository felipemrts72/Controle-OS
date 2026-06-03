import express from 'express';
import cors from 'cors';
import { authRoutes } from './routes/authRoutes.js';
import { userRoutes } from './routes/userRoutes.js';
import { sectorRoutes } from './routes/sectorRoutes.js';
import { productRoutes } from './routes/productRoutes.js';
import { internalOrderRoutes } from './routes/internalOrderRoutes.js';
import { taskRoutes } from './routes/taskRoutes.js';
import { labelRoutes } from './routes/labelRoutes.js';
import { shippingRoutes } from './routes/shippingRoutes.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { qrRoutes } from './routes/qrRoutes.js';
import { serviceRoutes } from './routes/serviceRoutes.js';
import { errorMiddleware } from './middlewares/errorMiddleware.js';

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/ping', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sectors', sectorRoutes);
app.use('/api/products', productRoutes);
app.use('/api/internal-orders', internalOrderRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api', dashboardRoutes);

app.use(errorMiddleware);
