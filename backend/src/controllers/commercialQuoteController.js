import {
  changeCommercialQuoteStatus,
  createCommercialQuote,
  duplicateCommercialQuote,
  emitCommercialQuote,
  getCommercialQuote,
  listCommercialQuotes,
  searchCommercialQuoteCustomers,
  searchCommercialQuoteProducts,
  updateCommercialQuote,
  concealQuoteSop,
} from '../services/commercialQuoteService.js';
import { pool } from '../database/pool.js';
import {
  buildQuotePreview,
  getLatestOfficialQuoteDocument,
} from '../services/commercialQuoteDocumentService.js';
import { sanitizePdfFilename } from '../services/pdf/pdfDocument.js';
import {
  duplicateLegacyCommercialQuote,
  getLegacyCommercialQuote,
  listCommercialQuoteOverview,
} from '../services/legacyCommercialQuoteService.js';
import { getOrCreateLegacyReconstructedDocument } from '../services/legacyCommercialQuoteDocumentService.js';

const handler = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req));
  } catch (error) {
    next(error);
  }
};

export const index = handler((req) => listCommercialQuoteOverview(req.query));
export const show = handler(async (req) => concealQuoteSop(await getCommercialQuote(req.params.id), req.user));
export const showLegacy = handler((req) => getLegacyCommercialQuote(req.params.id));
export const store = handler(async (req) => concealQuoteSop(await createCommercialQuote(req.body, req.user), req.user), 201);
export const update = handler(async (req) => concealQuoteSop(await updateCommercialQuote(req.params.id, req.body, req.user), req.user));
export const duplicate = handler(async (req) => concealQuoteSop(await duplicateCommercialQuote(req.params.id, req.user), req.user), 201);
export const emit = handler(async (req) => {
  const result = await emitCommercialQuote(req.params.id, req.user);
  return { ...result, quote: concealQuoteSop(result.quote, req.user) };
});
export const duplicateLegacy = handler(async (req) => concealQuoteSop(await duplicateLegacyCommercialQuote(req.params.id, req.user), req.user), 201);
export const updateStatus = handler(async (req) => concealQuoteSop(await changeCommercialQuoteStatus(req.params.id, req.body.status, req.user), req.user));
export const products = handler((req) => searchCommercialQuoteProducts(req.query.q, req.user));
export const customers = handler((req) => searchCommercialQuoteCustomers(req.query));

function sendQuotePdf(res, document, disposition) {
  const filename = sanitizePdfFilename(document.filename);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('Content-Length', document.pdf.length);
  res.setHeader('Cache-Control', 'private, no-store');
  if (document.sha256) res.setHeader('X-Document-SHA256', document.sha256);
  if (document.version) res.setHeader('X-Document-Version', String(document.version));
  res.setHeader('X-Quote-Document', document.classification || (document.official ? 'official' : 'current-preview'));
  res.send(document.pdf);
}

export async function legacyPdf(req, res, next) {
  try {
    const document = await getOrCreateLegacyReconstructedDocument(req.params.id, req.user.id);
    sendQuotePdf(res, document, req.query.download === '1' ? 'attachment' : 'inline');
  } catch (error) {
    next(error);
  }
}

export async function pdf(req, res, next) {
  try {
    const quote = await getCommercialQuote(req.params.id);
    let responseDocument;
    let document = await getLatestOfficialQuoteDocument(pool, quote.id);
    const documentIsCurrent = document && new Date(document.created_at).getTime() >= new Date(quote.updated_at).getTime();
    if (documentIsCurrent) {
      responseDocument = {
        pdf: document.pdf_data,
        filename: document.filename,
        sha256: document.sha256,
        version: document.document_version,
        official: true,
      };
    } else {
      const preview = await buildQuotePreview(quote);
      responseDocument = { ...preview, official: false };
    }
    sendQuotePdf(res, responseDocument, req.query.download === '1' ? 'attachment' : 'inline');
  } catch (error) {
    next(error);
  }
}
