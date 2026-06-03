import { Router } from 'express';
import { generateQrCodeBuffer } from '../utils/qrCode.js';

export const qrRoutes = Router();

qrRoutes.get('/test/:content', async (req, res, next) => {
  try {
    const qrCode = await generateQrCodeBuffer(req.params.content);
    res.setHeader('Content-Type', 'image/png');
    res.send(qrCode);
  } catch (error) {
    next(error);
  }
});
