import { pool, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { calculateSop } from './productCatalogService.js';
import { commercialQuoteInternals, getCommercialQuote } from './commercialQuoteService.js';
import { getCompanyPdfData } from './companySettingsService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGINS = new Set(['all', 'current', 'legacy']);

function assertUuid(value) {
  if (!UUID_PATTERN.test(String(value || ''))) throw httpError(400, 'Identificador inválido.');
}

function text(value, max = 180) {
  const result = value == null ? '' : String(value).trim();
  if (result.length > max) throw httpError(400, 'Filtro inválido.');
  return result;
}

export async function listCommercialQuoteOverview(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const origin = String(query.origin || 'all');
  if (!ORIGINS.has(origin)) throw httpError(400, 'Origem inválida.', { field: 'origin' });
  const search = text(query.search);
  const customer = text(query.customer);
  const status = text(query.status, 30);
  const startDate = query.start_date ? String(query.start_date).slice(0, 10) : '';
  const endDate = query.end_date ? String(query.end_date).slice(0, 10) : '';
  const result = await pool.query(`
    WITH unified AS (
      SELECT q.id,q.quote_number,q.commercial_number,q.customer_id,q.customer_name_snapshot,q.status,
        q.quote_date,q.valid_until,q.subtotal,q.discount_amount,q.freight_amount,q.total,q.created_at,q.updated_at,
        u.name AS responsible_name,'current'::text AS origin_type,NULL::text AS source_system,
        NULL::bigint AS source_legacy_number,
        (SELECT COUNT(*)::int FROM commercial_quote_items i WHERE i.commercial_quote_id=q.id) AS item_count,
        ARRAY[]::bigint[] AS duplicate_source_numbers
      FROM commercial_quotes q LEFT JOIN users u ON u.id=q.responsible_user_id
      UNION ALL
      SELECT l.id,('ERP-'||l.source_legacy_number)::varchar AS quote_number,l.legacy_number AS commercial_number,
        l.customer_id,l.customer_name_snapshot,l.source_status AS status,l.quote_date,NULL::date AS valid_until,
        l.subtotal,l.general_discount_amount AS discount_amount,l.freight_amount,l.total,l.imported_at AS created_at,
        l.imported_at AS updated_at,NULL::varchar AS responsible_name,'legacy'::text AS origin_type,l.source_system,
        l.source_legacy_number,l.item_count,
        ARRAY(SELECT a.source_legacy_number FROM commercial_legacy_quote_source_aliases a
          WHERE a.commercial_legacy_quote_id=l.id AND a.is_primary=FALSE ORDER BY a.source_legacy_number) AS duplicate_source_numbers
      FROM commercial_legacy_quotes l
    )
    SELECT u.*,COUNT(*) OVER()::int AS filtered_total
    FROM unified u
    WHERE ($1='all' OR u.origin_type=$1)
      AND ($2='' OR u.quote_number ILIKE '%'||$2||'%' OR u.commercial_number::text ILIKE '%'||$2||'%'
        OR u.customer_name_snapshot ILIKE '%'||$2||'%'
        OR (u.origin_type='legacy' AND regexp_replace($2,'[^0-9]','','g')<>'' AND EXISTS(SELECT 1 FROM commercial_legacy_quote_source_aliases a
          WHERE a.commercial_legacy_quote_id=u.id AND a.source_legacy_number::text ILIKE '%'||regexp_replace($2,'[^0-9]','','g')||'%')))
      AND ($3='' OR u.customer_name_snapshot ILIKE '%'||$3||'%')
      AND ($4='' OR u.status=$4)
      AND ($5='' OR u.quote_date >= $5::date)
      AND ($6='' OR u.quote_date <= $6::date)
    ORDER BY u.quote_date DESC,u.origin_type,u.commercial_number DESC
    LIMIT $7 OFFSET $8`, [origin, search, customer, status, startDate, endDate, limit, (page - 1) * limit]);
  const total = result.rows[0]?.filtered_total || 0;
  return { items: result.rows.map(({ filtered_total: _total, ...row }) => row),
    pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getLegacyCommercialQuote(id, database = pool) {
  assertUuid(id);
  const quote = (await database.query(`SELECT l.*,l.legacy_number AS commercial_number,
    ('ERP-'||l.source_legacy_number)::varchar AS quote_number,l.source_status AS status,
    l.general_discount_amount AS discount_amount,'legacy'::text AS origin_type
    FROM commercial_legacy_quotes l WHERE l.id=$1`, [id])).rows[0];
  if (!quote) throw httpError(404, 'Orçamento histórico não encontrado.');
  const items = (await database.query(`SELECT i.*,i.commercial_legacy_quote_id AS commercial_quote_id,
    'product'::text AS item_type,v.id AS product_catalog_version_id
    FROM commercial_legacy_quote_items i
    LEFT JOIN product_catalog_versions v ON i.legacy_include_catalog=TRUE
      AND v.source_system=$2 AND v.source_id=i.source_catalog_version_id
    WHERE i.commercial_legacy_quote_id=$1 ORDER BY i.line_order`, [id,quote.source_system])).rows;
  const payments = (await database.query(`SELECT p.*,p.commercial_legacy_quote_id AS commercial_quote_id,
    'amount'::text AS calculation_type,NULL::numeric AS percentage,NULL::date AS first_due_date,NULL::text AS notes
    FROM commercial_legacy_quote_payment_methods p WHERE p.commercial_legacy_quote_id=$1 ORDER BY p.line_order`, [id])).rows;
  const paymentIds = payments.map((row) => row.id);
  const installments = paymentIds.length ? (await database.query(`SELECT i.*,i.legacy_payment_method_id AS payment_method_id
    FROM commercial_legacy_quote_installments i WHERE i.legacy_payment_method_id=ANY($1::uuid[])
    ORDER BY i.legacy_payment_method_id,i.installment_number`, [paymentIds])).rows : [];
  const aliases = (await database.query(`SELECT source_id,source_legacy_number,is_primary,fingerprint
    FROM commercial_legacy_quote_source_aliases WHERE commercial_legacy_quote_id=$1 ORDER BY is_primary DESC,source_legacy_number`, [id])).rows;
  const documents = (await database.query(`SELECT id,document_kind,provenance_classification,storage_key,
    original_filename,mime_type,byte_size,sha256,renderer_version,created_at
    FROM commercial_legacy_quote_documents WHERE commercial_legacy_quote_id=$1 ORDER BY created_at DESC`, [id])).rows;
  return { ...quote, freight_amount: quote.freight_amount || '0.00', notes: quote.notes_snapshot,
    valid_until: null, responsible_name: null, created_by_name: 'Importação ERP Universal', items,
    payment_methods: payments.map((method) => ({ ...method, installments: installments.filter((row) => row.payment_method_id === method.id) })),
    aliases, documents, history: [], reconstructed_document: true };
}

async function companySnapshot(database) {
  const company = await getCompanyPdfData(database);
  const { logo, logo_url: _logoUrl, ...settings } = company;
  return { snapshot: { schema_version: 1, ...settings }, logo: logo || null };
}

export async function duplicateLegacyCommercialQuoteWithClient(id, user, client) {
  assertUuid(id);
  const source = await getLegacyCommercialQuote(id, client);
    const company = await companySnapshot(client);
    const quoteDate = new Date().toISOString().slice(0, 10);
    const quoteNumber = await commercialQuoteInternals.nextQuoteNumber(client, quoteDate);
    const commercialNumber = await commercialQuoteInternals.nextCommercialNumber(client);
    const created = (await client.query(`INSERT INTO commercial_quotes(quote_number,commercial_number,customer_id,
      customer_name_snapshot,customer_snapshot,company_snapshot,company_logo_snapshot,responsible_user_id,status,
      quote_date,valid_until,notes,items_gross_total,items_discount_total,subtotal,discount_amount,freight_amount,total,
      calculation_version,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,NULL,$10,$11,$12,$13,$14,0,$15,1,$8,$8) RETURNING *`,
    [quoteNumber,commercialNumber,source.customer_id,source.customer_name_snapshot,source.customer_snapshot,
      company.snapshot,company.logo,user.id,quoteDate,source.notes_snapshot,source.items_gross_total,
      source.items_discount_total,source.subtotal,source.general_discount_amount,source.total])).rows[0];

    for (const item of source.items) {
      let product = null; let catalog = null; let sop = null;
      if (item.commercial_product_id) {
        product = (await client.query('SELECT * FROM commercial_products WHERE id=$1 AND is_active=TRUE', [item.commercial_product_id])).rows[0] || null;
        if (product) catalog = (await client.query('SELECT * FROM product_catalogs WHERE commercial_product_id=$1', [product.id])).rows[0] || null;
        if (catalog) sop = calculateSop(catalog.reference_price,catalog.sop_discount_type,catalog.sop_discount_value);
      }
      const effectiveUnitPrice = Number(item.quantity) > 0 ? (Number(item.subtotal) / Number(item.quantity)).toFixed(2) : item.unit_price;
      const outsideSop = sop ? Number(effectiveUnitPrice) < Number(sop.minimum_price) : false;
      await client.query(`INSERT INTO commercial_quote_items(commercial_quote_id,line_order,item_type,product_id,
        commercial_product_id,product_code_snapshot,product_name_snapshot,measurement_unit_snapshot,description_snapshot,
        commercial_product_code_snapshot,commercial_product_name_snapshot,commercial_description_snapshot,quantity,
        unit_price,gross_subtotal,discount_amount,subtotal,product_catalog_id,product_catalog_version_id,reference_price_snapshot,
        sop_discount_type_snapshot,sop_discount_value_snapshot,sop_minimum_price_snapshot,effective_unit_price,is_outside_sop,
        save_product_requested)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,FALSE)`,
      [created.id,item.line_order,product?'product':'manual',product?.id||null,product?.commercial_code||item.product_code_snapshot,
        product?.name||item.product_name_snapshot,item.measurement_unit_snapshot,item.description_snapshot,
        product?.commercial_code||null,product?.name||null,product?.commercial_description||null,item.quantity,item.unit_price,
        item.gross_subtotal,item.discount_amount,item.subtotal,catalog?.id||null,catalog?.active_version_id||null,
        catalog?.reference_price||null,catalog?.sop_discount_type||null,catalog?.sop_discount_value||null,sop?.minimum_price||null,
        effectiveUnitPrice,outsideSop]);
    }
    for (const method of source.payment_methods) {
      const payment = (await client.query(`INSERT INTO commercial_quote_payment_methods(commercial_quote_id,line_order,
        method_type,description,calculation_type,percentage,amount,installment_count,first_due_date,notes)
        VALUES($1,$2,$3,$4,'amount',NULL,$5,$6,NULL,NULL) RETURNING id`,
      [created.id,method.line_order,method.method_type,method.description,method.amount,method.installment_count])).rows[0];
      for (const installment of method.installments) await client.query(`INSERT INTO commercial_quote_installments(
        payment_method_id,installment_number,due_date,amount) VALUES($1,$2,$3,$4)`,
      [payment.id,installment.installment_number,installment.due_date,installment.amount]);
    }
    await client.query(`INSERT INTO commercial_quote_history(commercial_quote_id,action,new_status,details,user_id)
      VALUES($1,'duplicated', 'draft',$2,$3)`, [created.id,{source_legacy_quote_id:source.id,source_legacy_number:source.legacy_number,
      source_system:source.source_system,source_original_number:source.source_legacy_number},user.id]);
    await logAudit(client,{entityType:'commercial_quote',entityId:created.id,action:'duplicate_legacy',
      newValue:{commercial_number:commercialNumber,source_legacy_quote_id:source.id,source_original_number:source.source_legacy_number},userId:user.id});
  return getCommercialQuote(created.id,client);
}

export async function duplicateLegacyCommercialQuote(id, user) {
  return transaction((client) => duplicateLegacyCommercialQuoteWithClient(id, user, client));
}
