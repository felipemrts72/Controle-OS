import * as service from '../services/productCatalogService.js';
import { httpError } from '../utils/httpError.js';
import { previewTechnicalCatalog } from '../services/technicalCatalogPdfService.js';

const handler = (fn, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await fn(req)); } catch (error) { next(error); }
};

export const index = handler((req) => service.listCatalogs(req.query, req.user));
export const showCommercialProduct = handler((req) => service.getCatalogByCommercialProduct(req.params.commercialProductId, req.user));
export const storeCommercialProduct = handler((req) => service.createCommercialProduct(req.body, req.user), 201);
export const updateCommercialProduct = handler((req) => service.updateCommercialProduct(req.params.commercialProductId, req.body, req.user));
export const quickOperationalProduct = handler((req) => service.quickOperationalProduct(req.body, req.user));
export const operationalProducts = handler((req) => service.listOperationalProductOptions(req.query.q));
export const manufacturingSectors = handler(() => service.listManufacturingSectors());
export const showByProduct = handler((req) => service.getCatalogByProduct(req.params.productId, req.user));
export const store = handler((req) => service.createCatalog(req.body, req.user), 201);
export const update = handler((req) => service.updateCatalog(req.params.catalogId, req.body, req.user));
export const createVersion = handler((req) => service.createCatalogVersion(req.params.catalogId, req.user, req.body?.source_version_id), 201);
export const updateVersion = handler((req) => service.updateCatalogVersion(req.params.versionId, req.body, req.user));
export const publishVersion = handler((req) => service.publishCatalogVersion(req.params.versionId, req.user, req.body?.version));
export const removeVersion = handler((req) => service.deleteCatalogVersion(req.params.versionId, req.user));
export async function previewVersion(req, res, next) {
  try {
    const pdf = await previewTechnicalCatalog(req.params.versionId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="catalogo-tecnico.pdf"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (error) { next(error); }
}
export const updateImage = handler((req) => service.updateCatalogImage(req.params.imageId, req.body, req.user));
export const removeImage = handler((req) => service.deleteCatalogImage(req.params.imageId, req.user));

export async function uploadImage(req, res, next) {
  try {
    let originalName;
    try { originalName = decodeURIComponent(String(req.headers['x-file-name'] || '')); }
    catch { throw httpError(400, 'Nome de arquivo inválido.'); }
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    res.status(201).json(await service.uploadCatalogImage(req.params.versionId, {
      originalName, mimeType, caption: req.headers['x-image-caption'] ? decodeURIComponent(String(req.headers['x-image-caption'])) : null,
    }, req.body, req.user));
  } catch (error) { next(error); }
}

export async function imageContent(req, res, next) {
  try {
    const image = await service.getCatalogImage(req.params.imageId);
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', image.buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(image.buffer);
  } catch (error) { next(error); }
}
