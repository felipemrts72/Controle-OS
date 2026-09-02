import { createHash } from 'node:crypto';
import { transaction } from '../database/pool.js';
import { sanitizePdfFilename } from './pdf/pdfDocument.js';
import { buildOrcamentoPdf } from './pdf/orcamentoPdfService.js';
import { getCompanyPdfData } from './companySettingsService.js';
import { buildLegacyQuoteDocumentData, loadFrozenQuoteCatalogs } from './commercialQuoteDocumentDataService.js';
import { getLegacyCommercialQuote } from './legacyCommercialQuoteService.js';

const RENDERER_VERSION = 'OLIMEN_PDFKIT_UNIVERSAL_V1';

function filenameFor(quote) {
  return sanitizePdfFilename(`Orcamento-${quote.legacy_number}-Historico-Reconstruido.pdf`);
}

function responseDocument(row) {
  return {
    pdf: row.pdf_data,
    filename: row.original_filename,
    sha256: row.sha256,
    classification: row.provenance_classification,
    rendererVersion: row.renderer_version,
  };
}

export async function getOrCreateLegacyReconstructedDocumentWithClient(quoteId, userId, client) {
    await client.query('SELECT id FROM commercial_legacy_quotes WHERE id=$1 FOR UPDATE', [quoteId]);
    const existing = (await client.query(`SELECT * FROM commercial_legacy_quote_documents
      WHERE commercial_legacy_quote_id=$1 AND provenance_classification='RECONSTRUCTED'
      ORDER BY created_at,id LIMIT 1`, [quoteId])).rows[0];
    if (existing?.pdf_data) return responseDocument(existing);

    const quote = await getLegacyCommercialQuote(quoteId, client);
    const { catalogs, imageAssets } = await loadFrozenQuoteCatalogs(client, quote);
    const company = await getCompanyPdfData(client);
    const { logo, logo_url: _logoUrl, ...companySnapshot } = company;
    const data = buildLegacyQuoteDocumentData(quote, { catalogs });
    const emittedAt = new Date();
    const pdf = await buildOrcamentoPdf(data, { ...companySnapshot, logo: logo || null }, {
      draft: false,
      emittedAt,
      catalogImageAssets: imageAssets,
    });
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const filename = filenameFor(quote);
    const storageKey = `database://commercial_legacy_quote_documents/${quote.id}/reconstructed.pdf`;
    const inserted = (await client.query(`INSERT INTO commercial_legacy_quote_documents(
      commercial_legacy_quote_id,document_kind,provenance_classification,storage_key,original_filename,
      mime_type,byte_size,sha256,import_run_id,pdf_data,document_data_snapshot,company_snapshot,
      company_logo_snapshot,renderer_version,created_by,created_at)
      VALUES($1,'reconstructed','RECONSTRUCTED',$2,$3,'application/pdf',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`, [quote.id, storageKey, filename, pdf.length, sha256, quote.import_run_id, pdf, data,
      companySnapshot, logo || null, RENDERER_VERSION, userId, emittedAt])).rows[0];
    return responseDocument(inserted);
}

export async function getOrCreateLegacyReconstructedDocument(quoteId, userId) {
  return transaction((client) => getOrCreateLegacyReconstructedDocumentWithClient(quoteId, userId, client));
}

export { RENDERER_VERSION };
