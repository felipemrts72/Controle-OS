import {
  getCompanyLogo,
  getCompanySettings,
  removeCompanyLogo,
  updateCompanySettings,
  uploadCompanyLogo,
} from '../services/companySettingsService.js';
import { httpError } from '../utils/httpError.js';

export async function show(_req, res, next) {
  try { res.json(await getCompanySettings()); } catch (error) { next(error); }
}

export async function update(req, res, next) {
  try { res.json(await updateCompanySettings(req.body, req.user)); } catch (error) { next(error); }
}

export async function logoShow(_req, res, next) {
  try {
    const logo = await getCompanyLogo();
    res.setHeader('Content-Type', logo.mimeType);
    res.setHeader('Content-Length', logo.buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(logo.buffer);
  } catch (error) { next(error); }
}

export async function logoUpdate(req, res, next) {
  try {
    let originalName;
    try {
      originalName = decodeURIComponent(String(req.headers['x-file-name'] || ''));
    } catch {
      throw httpError(400, 'Nome de arquivo inválido.');
    }
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    res.json(await uploadCompanyLogo({ originalName, mimeType }, req.body, req.user));
  } catch (error) { next(error); }
}

export async function logoDestroy(req, res, next) {
  try { res.json(await removeCompanyLogo(req.user)); } catch (error) { next(error); }
}
