import {
  changeCommercialQuoteStatus,
  createCommercialQuote,
  duplicateCommercialQuote,
  getCommercialQuote,
  listCommercialQuotes,
  searchCommercialQuoteCustomers,
  searchCommercialQuoteProducts,
  updateCommercialQuote,
  concealQuoteSop,
} from '../services/commercialQuoteService.js';
import { pool, transaction } from '../database/pool.js';
import {
  buildQuotePreview,
  createOfficialQuoteDocument,
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
  res.setHeader('X-Quote-Document', document.classification || (document.official ? 'official' : 'draft-preview'));
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
    if (quote.status === 'draft') {
      const preview = await buildQuotePreview(quote);
      responseDocument = { ...preview, official: false };
    } else {
      let document = await getLatestOfficialQuoteDocument(pool, quote.id);
      if (!document) {
        document = await transaction(async (client) => {
          await client.query('SELECT id FROM commercial_quotes WHERE id = $1 FOR UPDATE', [quote.id]);
          const existing = await getLatestOfficialQuoteDocument(client, quote.id);
          return existing || createOfficialQuoteDocument(client, await getCommercialQuote(quote.id, client), req.user.id);
        });
      }
      responseDocument = {
        pdf: document.pdf_data,
        filename: document.filename,
        sha256: document.sha256,
        version: document.document_version,
        official: true,
      };
    }
    sendQuotePdf(res, responseDocument, req.query.download === '1' ? 'attachment' : 'inline');
  } catch (error) {
    next(error);
  }
}
