import { createHash } from 'node:crypto';
import { pool } from '../database/pool.js';
import { buildQuoteDocumentData, loadFrozenQuoteCatalogs } from './commercialQuoteDocumentDataService.js';
import { buildOrcamentoPdf } from './pdf/orcamentoPdfService.js';
import { sanitizePdfFilename } from './pdf/pdfDocument.js';

function companyForPdf(quote) {
  return { ...(quote.company_snapshot || {}), logo: quote.company_logo_snapshot || null };
}

function commercialFilename(quote, { draft = false } = {}) {
  const identity = quote.commercial_number == null ? 'Sem-Numero-Comercial' : String(quote.commercial_number);
  return sanitizePdfFilename(`Orcamento-${identity}${draft ? '-Rascunho' : ''}.pdf`);
}

export async function buildQuotePreview(quote, database = pool) {
  const { catalogs, imageAssets } = await loadFrozenQuoteCatalogs(database, quote);
  const data = buildQuoteDocumentData(quote, { catalogs });
  const pdf = await buildOrcamentoPdf(data, companyForPdf(quote), {
    draft: quote.status === 'draft', catalogImageAssets: imageAssets,
  });
  return { pdf, data, filename: commercialFilename(quote, { draft: quote.status === 'draft' }) };
}

export async function createOfficialQuoteDocument(client, quote, userId, { forceNewVersion = false } = {}) {
  const existing = await client.query(
    `SELECT * FROM commercial_quote_documents
     WHERE commercial_quote_id = $1 ORDER BY document_version DESC LIMIT 1`,
    [quote.id],
  );
  if (existing.rows[0] && !forceNewVersion) return existing.rows[0];

  const { catalogs, imageAssets } = await loadFrozenQuoteCatalogs(client, quote);
  const data = buildQuoteDocumentData(quote, { catalogs });
  const createdAt = new Date();
  const pdf = await buildOrcamentoPdf(data, companyForPdf(quote), {
    draft: false, emittedAt: createdAt, catalogImageAssets: imageAssets,
  });
  const hash = createHash('sha256').update(pdf).digest('hex');
  const version = Number(existing.rows[0]?.document_version || 0) + 1;
  const filename = commercialFilename(quote);
  const result = await client.query(
    `INSERT INTO commercial_quote_documents (
      commercial_quote_id, document_version, quote_status, filename, pdf_data, byte_size, sha256,
      document_data_snapshot, company_snapshot, company_logo_snapshot, created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [quote.id, version, quote.status, filename, pdf, pdf.length, hash, data,
      quote.company_snapshot || {}, quote.company_logo_snapshot || null, userId, createdAt],
  );
  return result.rows[0];
}

export async function getLatestOfficialQuoteDocument(database, quoteId) {
  const result = await database.query(
    `SELECT * FROM commercial_quote_documents
     WHERE commercial_quote_id = $1 ORDER BY document_version DESC LIMIT 1`,
    [quoteId],
  );
  return result.rows[0] || null;
}
