import { getProductImage, removeProductImage, saveProductImage } from '../services/productImageService.js';
import { httpError } from '../utils/httpError.js';

export async function upload(req, res, next) {
  try {
    let originalName;
    try {
      originalName = decodeURIComponent(String(req.headers['x-file-name'] || ''));
    } catch {
      throw httpError(400, 'Nome de arquivo inválido.');
    }
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const creationToken = String(req.headers['x-product-create-token'] || '');
    res.json(await saveProductImage(req.params.id, { originalName, mimeType, creationToken }, req.body, req.user));
  } catch (error) {
    next(error);
  }
}

export async function remove(req, res, next) {
  try {
    res.json(await removeProductImage(req.params.id, req.user));
  } catch (error) {
    next(error);
  }
}

export async function show(req, res, next) {
  try {
    const image = await getProductImage(req.params.id);
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', image.buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(image.buffer);
  } catch (error) {
    next(error);
  }
}
