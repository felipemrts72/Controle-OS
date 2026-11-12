import {
  getCompanyLogo,
  getCompanySettings,
  getRepresentativeSignature,
  saveRepresentativeSignature,
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

function uploadedImage(req) {
  let originalName;
  try {
    originalName = decodeURIComponent(String(req.headers['x-file-name'] || ''));
  } catch {
    throw httpError(400, 'Nome de arquivo inválido.');
  }
  const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return { originalName, mimeType };
}

export async function logoUpdate(req, res, next) {
  try {
    res.json(await uploadCompanyLogo(uploadedImage(req), req.body, req.user));
  } catch (error) { next(error); }
}

export async function logoDestroy(req, res, next) {
  try { res.json(await removeCompanyLogo(req.user)); } catch (error) { next(error); }
}

export async function signatureShow(_req, res, next) {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    const signature = await getRepresentativeSignature();
    if (!signature) return res.status(204).end();
    res.setHeader('Content-Type', signature[0] === 0x89 ? 'image/png' : 'image/jpeg');
    res.send(signature);
  } catch (error) { next(error); }
}

export async function signatureUpdate(req, res, next) {
  try {
    await saveRepresentativeSignature(uploadedImage(req), req.body, req.user);
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function signatureDestroy(req, res, next) {
  try {
    await saveRepresentativeSignature(null, null, req.user);
    res.status(204).end();
  } catch (error) { next(error); }
}
