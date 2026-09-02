import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const UNIDENTIFIED_CUSTOMER = 'Cliente não identificado';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const catalogUploadRoot = path.resolve(process.env.CATALOG_IMAGE_UPLOAD_DIR || path.join(projectRoot, 'uploads', 'commercial-catalog'));

function text(value, fallback = null) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const normalized = String(value);
  const isoDate = normalized.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return isoDate || null;
}

export function buildQuoteDocumentData(quote, { catalogs = [] } = {}) {
  const customerSnapshot = quote.customer_snapshot || {};
  const customerName = text(customerSnapshot.name)
    || text(quote.customer_name_snapshot)
    || UNIDENTIFIED_CUSTOMER;

  return {
    schema_version: 1,
    quote: {
      id: quote.id,
      commercial_number: quote.commercial_number == null ? null : Number(quote.commercial_number),
      technical_number: quote.quote_number,
      status: quote.status,
      date: dateOnly(quote.quote_date),
      valid_until: dateOnly(quote.valid_until),
    },
    customer: {
      source: quote.customer_id ? 'registered' : (customerName === UNIDENTIFIED_CUSTOMER ? 'unidentified' : 'free_text'),
      name: customerName,
      trade_name: text(customerSnapshot.trade_name),
      person_type: text(customerSnapshot.person_type),
      tax_id: text(customerSnapshot.tax_id),
      phone: text(customerSnapshot.phone),
      whatsapp: text(customerSnapshot.whatsapp),
      email: text(customerSnapshot.email),
      address: {
        zip_code: text(customerSnapshot.address?.zip_code),
        street: text(customerSnapshot.address?.street),
        number: text(customerSnapshot.address?.number),
        complement: text(customerSnapshot.address?.complement),
        neighborhood: text(customerSnapshot.address?.neighborhood),
        city: text(customerSnapshot.address?.city),
        state: text(customerSnapshot.address?.state),
      },
    },
    items: (quote.items || []).map((item) => ({
      order: item.line_order,
      type: item.item_type,
      code: text(item.commercial_product_code_snapshot) || text(item.product_code_snapshot),
      name: text(item.commercial_product_name_snapshot) || text(item.product_name_snapshot, 'Item'),
      unit: text(item.measurement_unit_snapshot),
      description: text(item.commercial_description_snapshot) || text(item.description_snapshot),
      quantity: String(item.quantity),
      unit_price: String(item.unit_price),
      discount_amount: String(item.discount_amount),
      total: String(item.subtotal),
    })),
    payment_methods: (quote.payment_methods || []).map((method) => ({
      order: method.line_order,
      type: method.method_type,
      description: text(method.description, 'Condição de pagamento'),
      calculation_type: method.calculation_type,
      percentage: method.percentage === null || method.percentage === undefined ? null : String(method.percentage),
      amount: String(method.amount),
      installment_count: Number(method.installment_count),
      first_due_date: dateOnly(method.first_due_date),
      notes: text(method.notes),
      installments: (method.installments || []).map((installment) => ({
        number: Number(installment.installment_number),
        due_date: dateOnly(installment.due_date),
        amount: String(installment.amount),
      })),
    })),
    totals: {
      gross: String(quote.items_gross_total),
      item_discount: String(quote.items_discount_total),
      subtotal: String(quote.subtotal),
      general_discount: String(quote.discount_amount),
      freight: String(quote.freight_amount),
      total: String(quote.total),
    },
    commercial_notes: text(quote.notes),
    catalogs: Array.isArray(catalogs) ? catalogs : [],
  };
}

// Adapter documental: mantém o renderer único e apenas traduz snapshots do
// histórico ERP para o contrato já utilizado pelos Orçamentos modernos.
export function buildLegacyQuoteDocumentData(legacyQuote, { catalogs = [] } = {}) {
  const data = buildQuoteDocumentData(legacyQuote, { catalogs });
  return {
    ...data,
    quote: {
      ...data.quote,
      document_origin: 'RECONSTRUCTED',
      source_system: legacyQuote.source_system,
      source_legacy_number: Number(legacyQuote.source_legacy_number),
      source_reference: `ERP original #${legacyQuote.source_legacy_number}`,
    },
    provenance: {
      classification: 'RECONSTRUCTED',
      total_provenance: legacyQuote.total_provenance,
      calculation_version: legacyQuote.calculation_version,
      payload_hash: legacyQuote.payload_hash,
    },
  };
}

function resolveCatalogImage(storedName) {
  if (!storedName || path.basename(storedName) !== storedName || storedName.includes('..')) return null;
  const resolved = path.resolve(catalogUploadRoot, storedName);
  const relative = path.relative(catalogUploadRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function loadCatalogImage(image) {
  const absolutePath = resolveCatalogImage(image.stored_name);
  if (!absolutePath) return null;
  try {
    const original = await fs.readFile(absolutePath);
    const buffer = image.mime_type === 'image/webp' ? await sharp(original).png().toBuffer() : original;
    return { buffer, sha256: createHash('sha256').update(original).digest('hex') };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[PDF] Não foi possível carregar imagem congelada do Catálogo ${image.id}: ${error.message}`);
    return null;
  }
}

// Carrega somente product_catalog_version_id congelado nos itens. Nunca usa a
// versão ativa corrente do Produto para compor um documento histórico.
export async function loadFrozenQuoteCatalogs(database, quote) {
  const versionIds = [];
  for (const item of quote.items || []) {
    if (item.item_type !== 'product' || !item.product_catalog_version_id) continue;
    const id = String(item.product_catalog_version_id);
    if (!versionIds.includes(id)) versionIds.push(id);
  }
  if (!versionIds.length) return { catalogs: [], imageAssets: {} };

  const versionsResult = await database.query(
      `SELECT v.id,v.version_number,v.status,v.commercial_title,v.subtitle,v.presentation_text,
        v.applications_text,v.additional_text,v.notes,c.product_id,c.commercial_product_id,
        COALESCE(cp.name,p.name) AS product_name
       FROM product_catalog_versions v
       JOIN product_catalogs c ON c.id=v.product_catalog_id
       LEFT JOIN commercial_products cp ON cp.id=c.commercial_product_id
       LEFT JOIN products p ON p.id=c.product_id
       WHERE v.id=ANY($1::uuid[])`,
      [versionIds],
    );
  const specificationsResult = await database.query('SELECT id,product_catalog_version_id,name,value,unit,position FROM product_catalog_specifications WHERE product_catalog_version_id=ANY($1::uuid[]) ORDER BY position,id', [versionIds]);
  const includedResult = await database.query('SELECT id,product_catalog_version_id,description,quantity,unit,notes,position FROM product_catalog_included_items WHERE product_catalog_version_id=ANY($1::uuid[]) ORDER BY position,id', [versionIds]);
  const imagesResult = await database.query('SELECT id,product_catalog_version_id,stored_name,mime_type,caption,position,is_primary FROM product_catalog_images WHERE product_catalog_version_id=ANY($1::uuid[]) ORDER BY is_primary DESC,position,id', [versionIds]);

  const loadedImages = await Promise.all(imagesResult.rows.map(async (image) => ({ image, loaded: await loadCatalogImage(image) })));
  const imageAssets = {};
  for (const { image, loaded } of loadedImages) if (loaded?.buffer) imageAssets[image.id] = loaded.buffer;
  const versions = new Map(versionsResult.rows.map((version) => [String(version.id), version]));
  const catalogs = versionIds.map((versionId) => {
    const version = versions.get(versionId);
    if (!version) return null;
    return {
      schema_version: 1,
      version_id: version.id,
      product_id: version.product_id,
      commercial_product_id: version.commercial_product_id,
      version_number: Number(version.version_number),
      version_status: version.status,
      product_name: text(version.product_name),
      commercial_title: text(version.commercial_title, 'Equipamento'),
      subtitle: text(version.subtitle),
      presentation_text: text(version.presentation_text),
      applications_text: text(version.applications_text),
      additional_text: text(version.additional_text),
      notes: text(version.notes),
      specifications: specificationsResult.rows.filter((row) => String(row.product_catalog_version_id) === versionId).map((row) => ({
        name: text(row.name), value: text(row.value), unit: text(row.unit), position: Number(row.position),
      })),
      included_items: includedResult.rows.filter((row) => String(row.product_catalog_version_id) === versionId).map((row) => ({
        description: text(row.description), quantity: row.quantity == null ? null : String(row.quantity), unit: text(row.unit), notes: text(row.notes), position: Number(row.position),
      })),
      images: loadedImages.filter(({ image }) => String(image.product_catalog_version_id) === versionId).map(({ image, loaded }) => ({
        id: image.id, caption: text(image.caption), position: Number(image.position), is_primary: Boolean(image.is_primary),
        mime_type: image.mime_type, sha256: loaded?.sha256 || null, available: Boolean(loaded?.buffer),
      })),
    };
  }).filter(Boolean);
  return { catalogs, imageAssets };
}

export { UNIDENTIFIED_CUSTOMER };
