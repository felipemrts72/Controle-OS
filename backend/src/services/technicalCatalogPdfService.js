import { transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { getCompanyPdfData } from './companySettingsService.js';
import { loadFrozenQuoteCatalogs } from './commercialQuoteDocumentDataService.js';
import { buildTechnicalCatalogPdf } from './pdf/orcamentoPdfService.js';

export async function previewTechnicalCatalog(versionId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionId)) throw httpError(400, 'Identificador inválido.');
  return transaction(async (client) => {
    // Consistent preview without recording historical usage.
    const version = (await client.query('SELECT id FROM product_catalog_versions WHERE id=$1 FOR SHARE', [versionId])).rows[0];
    if (!version) throw httpError(404, 'Versão não encontrada.');
    const { catalogs, imageAssets } = await loadFrozenQuoteCatalogs(client, { items: [{ item_type: 'product', product_catalog_version_id: versionId }] });
    return buildTechnicalCatalogPdf(catalogs, await getCompanyPdfData(client), { catalogImageAssets: imageAssets });
  });
}
