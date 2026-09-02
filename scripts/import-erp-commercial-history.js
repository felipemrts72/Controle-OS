import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const SOURCE_SYSTEM = 'ERP_UNIVERSAL';
const IMPORT_TYPE = 'COMMERCIAL_HISTORY_V1';
const CALCULATION_VERSION = 'ERP_UNIVERSAL_V1';
const TOTAL_PROVENANCE = 'reconstructed_from_source_rows';
const EXPECTED_REFERENCE = {
  quotes: 47, items: 114, gross: '5508205.00', itemDiscount: '162800.00',
  generalDiscount: '10.00', total: '5345395.00', minimum: 2, maximum: 105,
};

const [erpEnvPath, olimenEnvPath, erpBackendRoot, mode] = process.argv.slice(2);
if (!erpEnvPath || !olimenEnvPath || !erpBackendRoot || !['--preflight', '--apply'].includes(mode)) {
  throw new Error('Uso: node scripts/import-erp-commercial-history.js <erp-env> <olimen-env> <erp-backend-root> <--preflight|--apply>');
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erpEnv = dotenv.parse(await fs.readFile(path.resolve(erpEnvPath), 'utf8'));
const olimenEnv = dotenv.parse(await fs.readFile(path.resolve(olimenEnvPath), 'utf8'));
if (!erpEnv.DATABASE_URL || !olimenEnv.DATABASE_URL) throw new Error('DATABASE_URL ausente.');
const catalogUploadRoot = path.resolve(olimenEnv.CATALOG_IMAGE_UPLOAD_DIR || path.join(projectRoot, 'uploads', 'commercial-catalog'));

const erp = new pg.Client({ connectionString: erpEnv.DATABASE_URL });
const olimen = new pg.Client({ connectionString: olimenEnv.DATABASE_URL });
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashObject = (value) => sha256(JSON.stringify(value));
const normalizedName = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
const money = (value) => Number(value || 0).toFixed(2);
const clean = (value) => value == null || String(value).trim() === '' ? null : String(value).trim();

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) result.set(row[key], [...(result.get(row[key]) || []), row]);
  return result;
}

async function loadSource() {
  await erp.query('BEGIN TRANSACTION READ ONLY');
  const quotes = (await erp.query('SELECT * FROM orcamentos ORDER BY data_orcamento,criado_em,id')).rows;
  const items = (await erp.query(`
    SELECT i.*,p.nome AS source_product_name,p.descricao AS source_product_description,
      p.sku AS source_product_code,p.unidade_medida AS source_product_unit,
      (i.quantidade*i.preco_unitario)::numeric(16,2) AS gross_subtotal,
      (CASE WHEN i.desconto_valor>0 THEN i.desconto_valor*i.quantidade
        ELSE i.quantidade*i.preco_unitario*i.desconto_percentual/100 END)::numeric(16,2) AS calculated_discount,
      GREATEST(i.quantidade*i.preco_unitario-(CASE WHEN i.desconto_valor>0
        THEN i.desconto_valor*i.quantidade
        ELSE i.quantidade*i.preco_unitario*i.desconto_percentual/100 END),0)::numeric(16,2) AS calculated_subtotal
    FROM itens_orcamento i LEFT JOIN produtos p ON p.id=i.produto_id ORDER BY i.orcamento_id,i.id`)).rows;
  const payments = (await erp.query('SELECT * FROM orcamento_formas_pagamento ORDER BY orcamento_id,ordem,id')).rows;
  const installments = (await erp.query('SELECT * FROM orcamento_pagamento_parcelas ORDER BY forma_pagamento_id,numero_parcela,id')).rows;
  const products = (await erp.query(`SELECT * FROM produtos
    WHERE id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL) ORDER BY id`)).rows;
  const catalogs = (await erp.query(`SELECT * FROM catalogo_produto
    WHERE produto_id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL) ORDER BY produto_id`)).rows;
  const catalogIds = catalogs.map((row) => row.id);
  const versions = catalogIds.length ? (await erp.query('SELECT * FROM catalogo_versoes WHERE catalogo_id=ANY($1::int[]) ORDER BY catalogo_id,versao', [catalogIds])).rows : [];
  const versionIds = versions.map((row) => row.id);
  const images = versionIds.length ? (await erp.query('SELECT * FROM catalogo_imagens WHERE versao_id=ANY($1::int[]) ORDER BY versao_id,ordem,id', [versionIds])).rows : [];
  const specifications = versionIds.length ? (await erp.query('SELECT * FROM catalogo_especificacoes WHERE versao_id=ANY($1::int[]) ORDER BY versao_id,ordem,id', [versionIds])).rows : [];
  const includedItems = versionIds.length ? (await erp.query('SELECT * FROM catalogo_itens_inclusos WHERE versao_id=ANY($1::int[]) ORDER BY versao_id,ordem,id', [versionIds])).rows : [];
  return { quotes, items, payments, installments, products, catalogs, versions, images, specifications, includedItems };
}

function buildModel(source) {
  const itemsByQuote = groupBy(source.items, 'orcamento_id');
  const paymentsByQuote = groupBy(source.payments, 'orcamento_id');
  const installmentsByPayment = groupBy(source.installments, 'forma_pagamento_id');
  const productsById = new Map(source.products.map((row) => [row.id, row]));
  const versionsByCatalog = groupBy(source.versions, 'catalogo_id');
  const catalogsByProduct = new Map(source.catalogs.map((row) => [row.produto_id, row]));
  const imagesByVersion = groupBy(source.images, 'versao_id');
  const specsByVersion = groupBy(source.specifications, 'versao_id');
  const includedByVersion = groupBy(source.includedItems, 'versao_id');

  const quoteModels = source.quotes.map((quote) => {
    const quoteItems = itemsByQuote.get(quote.id) || [];
    const quotePayments = (paymentsByQuote.get(quote.id) || []).map((payment) => ({
      ...payment, installments: installmentsByPayment.get(payment.id) || [],
    }));
    const gross = quoteItems.reduce((sum, item) => sum + Number(item.gross_subtotal), 0);
    const itemDiscount = quoteItems.reduce((sum, item) => sum + Number(item.calculated_discount), 0);
    const subtotal = gross - itemDiscount;
    const total = Math.max(subtotal - Number(quote.desconto_geral), 0);
    const paymentTotal = quotePayments.length ? quotePayments.reduce((sum, row) => sum + Number(row.valor), 0) : null;
    const commercialPayload = {
      customer_name: clean(quote.cliente_nome), source_customer_id: quote.cliente_id == null ? null : String(quote.cliente_id),
      quote_date: quote.data_orcamento, status: quote.status, notes: quote.observacoes || null,
      general_discount: money(quote.desconto_geral), freight: null,
      items: quoteItems.map((item, index) => ({
        order: index + 1, product_id: item.produto_id == null ? null : String(item.produto_id),
        code: item.source_product_code || null,
        name: clean(item.nome_customizado) || clean(item.source_product_name) || clean(item.descricao) || `Item ERP ${item.id}`,
        description: clean(item.descricao) || clean(item.source_product_description), unit: item.source_product_unit || null,
        quantity: String(item.quantidade), unit_price: money(item.preco_unitario),
        unit_discount: money(item.desconto_valor), discount_percent: money(item.desconto_percentual),
        gross: money(item.gross_subtotal), discount: money(item.calculated_discount), total: money(item.calculated_subtotal),
        include_catalog: Boolean(item.incluir_catalogo), catalog_version_id: item.catalogo_versao_id == null ? null : String(item.catalogo_versao_id),
      })),
      payments: quotePayments.map((payment, index) => ({
        order: index + 1, method: payment.forma, amount: money(payment.valor), installments: Number(payment.parcelas),
        details: payment.installments.map((installment) => ({ number: Number(installment.numero_parcela), due_date: installment.data_vencimento, amount: money(installment.valor) })),
      })),
      totals: { gross: money(gross), item_discount: money(itemDiscount), subtotal: money(subtotal), total: money(total), payment_total: paymentTotal == null ? null : money(paymentTotal) },
    };
    return { ...quote, items: quoteItems, payments: quotePayments, totals: commercialPayload.totals,
      fingerprint: hashObject(commercialPayload), commercialPayload };
  });

  const byFingerprint = groupBy(quoteModels, 'fingerprint');
  const canonicalQuotes = [];
  const duplicateGroups = [];
  for (const group of byFingerprint.values()) {
    group.sort((a, b) => a.id - b.id);
    canonicalQuotes.push({ ...group[0], aliases: group.slice(1) });
    if (group.length > 1) duplicateGroups.push({ primary: group[0].id, duplicates: group.slice(1).map((row) => row.id), fingerprint: group[0].fingerprint });
  }
  const instant = (value) => value == null ? Number.POSITIVE_INFINITY : new Date(value).getTime();
  canonicalQuotes.sort((a, b) => instant(a.data_orcamento) - instant(b.data_orcamento)
    || instant(a.criado_em) - instant(b.criado_em) || a.id - b.id);
  canonicalQuotes.forEach((quote, index) => { quote.legacyNumber = index + 1; });

  const manualMap = new Map();
  for (const item of source.items.filter((row) => row.produto_id == null)) {
    const name = clean(item.nome_customizado) || clean(item.descricao) || 'Item ERP sem nome';
    const key = normalizedName(name);
    if (!manualMap.has(key)) manualMap.set(key, { key, name, sourceId: `manual:${sha256(key).slice(0, 32)}`, itemIds: [] });
    manualMap.get(key).itemIds.push(item.id);
  }

  const catalogModels = source.catalogs.map((catalog) => ({
    ...catalog,
    versions: (versionsByCatalog.get(catalog.id) || []).map((version) => ({ ...version,
      images: imagesByVersion.get(version.id) || [], specifications: specsByVersion.get(version.id) || [],
      includedItems: includedByVersion.get(version.id) || [],
    })),
  }));
  const catalogByProduct = new Map(catalogModels.map((row) => [row.produto_id, row]));
  const productModels = source.products.map((product) => {
    const catalog = catalogByProduct.get(product.id) || null;
    const activeVersion = catalog?.versions.find((row) => row.ativo) || null;
    const payload = { ...product, catalog };
    return { ...product, catalog, activeVersion, commercialName: clean(activeVersion?.nome_comercial) || clean(product.nome), payloadHash: hashObject(payload) };
  });

  const rawTotals = quoteModels.reduce((totals, quote) => ({
    gross: totals.gross + Number(quote.totals.gross), itemDiscount: totals.itemDiscount + Number(quote.totals.item_discount),
    generalDiscount: totals.generalDiscount + Number(quote.desconto_geral), total: totals.total + Number(quote.totals.total),
    payments: totals.payments + (quote.totals.payment_total == null ? 0 : Number(quote.totals.payment_total)),
  }), { gross: 0, itemDiscount: 0, generalDiscount: 0, total: 0, payments: 0 });
  const uniqueTotals = canonicalQuotes.reduce((totals, quote) => ({
    gross: totals.gross + Number(quote.totals.gross), itemDiscount: totals.itemDiscount + Number(quote.totals.item_discount),
    generalDiscount: totals.generalDiscount + Number(quote.desconto_geral), total: totals.total + Number(quote.totals.total),
    payments: totals.payments + (quote.totals.payment_total == null ? 0 : Number(quote.totals.payment_total)),
    items: totals.items + quote.items.length,
  }), { gross: 0, itemDiscount: 0, generalDiscount: 0, total: 0, payments: 0, items: 0 });

  return { ...source, quoteModels, canonicalQuotes, duplicateGroups, productModels,
    productsById, manualProducts: [...manualMap.values()], manualMap, rawTotals, uniqueTotals,
    sourcePayloadHash: hashObject({ quoteModels: quoteModels.map((q) => q.commercialPayload), productModels: productModels.map((p) => ({ id: p.id, hash: p.payloadHash })) }),
  };
}

function assertPreflight(model) {
  const actual = {
    quotes: model.quoteModels.length, items: model.items.length,
    gross: money(model.rawTotals.gross), itemDiscount: money(model.rawTotals.itemDiscount),
    generalDiscount: money(model.rawTotals.generalDiscount), total: money(model.rawTotals.total),
    minimum: Math.min(...model.quoteModels.map((row) => row.id)), maximum: Math.max(...model.quoteModels.map((row) => row.id)),
  };
  for (const [key, expected] of Object.entries(EXPECTED_REFERENCE)) {
    if (String(actual[key]) !== String(expected)) throw new Error(`PREFLIGHT_DIVERGENT:${key}: esperado ${expected}, encontrado ${actual[key]}`);
  }
  const invalidNumbers = model.quoteModels.filter((row) => row.id >= 250).map((row) => row.id);
  if (invalidNumbers.length) throw new Error(`PREFLIGHT_NUMBER_AT_OR_ABOVE_250:${invalidNumbers.join(',')}`);
  const expectedDuplicates = model.duplicateGroups.find((group) => group.primary === 95
    && JSON.stringify(group.duplicates) === JSON.stringify([96, 97]));
  if (!expectedDuplicates || model.duplicateGroups.length !== 1) throw new Error(`PREFLIGHT_DUPLICATION_CHANGED:${JSON.stringify(model.duplicateGroups)}`);
  if (model.canonicalQuotes.length > 249) throw new Error('PREFLIGHT_LEGACY_RANGE_EXHAUSTED');
  if (model.productModels.length !== 61 || model.manualProducts.length !== 4) throw new Error('PREFLIGHT_PRODUCT_SET_CHANGED');
  return actual;
}

async function inspectImages(model) {
  const inspected = [];
  for (const image of model.images) {
    const relative = String(image.caminho_imagem || '').replace(/^[/\\]+/, '').replaceAll('/', path.sep);
    const absolute = path.resolve(erpBackendRoot, relative);
    const allowedRoot = path.resolve(erpBackendRoot, 'uploads') + path.sep;
    if (!absolute.startsWith(allowedRoot)) throw new Error(`ERP_IMAGE_OUTSIDE_UPLOADS:${image.id}`);
    const buffer = await fs.readFile(absolute);
    const extension = path.extname(absolute).toLowerCase();
    const mimeType = extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : null;
    if (!mimeType) throw new Error(`ERP_IMAGE_UNSUPPORTED:${image.id}:${extension}`);
    inspected.push({ ...image, absolute, buffer, extension: extension === '.jpeg' ? '.jpg' : extension,
      mimeType, sha256: sha256(buffer), byteSize: buffer.length });
  }
  return inspected;
}

async function getProtectedCounts(client) {
  const allowed = new Set(['commercial_products','product_catalogs','product_catalog_versions','product_catalog_images',
    'product_catalog_specifications','product_catalog_included_items','integration_import_runs','integration_import_records',
    'commercial_legacy_quotes','commercial_legacy_quote_source_aliases','commercial_legacy_quote_items',
    'commercial_legacy_quote_payment_methods','commercial_legacy_quote_installments','commercial_legacy_quote_documents']);
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows
    .map((row) => row.tablename).filter((name) => !allowed.has(name));
  const counts = {};
  for (const table of tables) counts[table] = Number((await client.query(`SELECT COUNT(*)::int total FROM "${table}"`)).rows[0].total);
  return counts;
}

async function recordLedger(client, runId, { entityType, sourceId, sourceLegacyNumber = null, destinationTable = null,
  destinationId = null, action, fingerprint = null, canonicalSourceId = null, metadata = {}, warnings = [] }) {
  await client.query(`INSERT INTO integration_import_records(import_run_id,source_system,entity_type,source_id,
    source_legacy_number,destination_table,destination_id,action,fingerprint,canonical_source_id,metadata,warnings)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [runId,SOURCE_SYSTEM,entityType,String(sourceId),sourceLegacyNumber,destinationTable,destinationId,action,
    fingerprint,canonicalSourceId == null ? null : String(canonicalSourceId),JSON.stringify(metadata),JSON.stringify(warnings)]);
}

async function stageImages(inspectedImages) {
  await fs.mkdir(catalogUploadRoot, { recursive: true });
  const createdFiles = [];
  const byHash = new Map();
  for (const image of inspectedImages) {
    const storedName = `erp-${image.sha256}${image.extension}`;
    const target = path.resolve(catalogUploadRoot, storedName);
    if (path.dirname(target) !== catalogUploadRoot) throw new Error('CATALOG_STORAGE_PATH_INVALID');
    if (!byHash.has(image.sha256)) {
      try {
        await fs.copyFile(image.absolute, target, fsConstants.COPYFILE_EXCL);
        createdFiles.push(target);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fs.readFile(target);
        if (sha256(existing) !== image.sha256) throw new Error(`CATALOG_STORAGE_HASH_CONFLICT:${storedName}`);
      }
      byHash.set(image.sha256, storedName);
    }
    image.storedName = byHash.get(image.sha256);
  }
  return createdFiles;
}

async function importData(model, inspectedImages) {
  const existingRun = (await olimen.query(`SELECT * FROM integration_import_runs
    WHERE source_system=$1 AND import_type=$2 AND source_payload_hash=$3 AND status='completed'
    ORDER BY completed_at DESC LIMIT 1`, [SOURCE_SYSTEM,IMPORT_TYPE,model.sourcePayloadHash])).rows[0];
  if (existingRun) return { idempotent_reuse: true, import_run_id: existingRun.id, stats: existingRun.stats, warnings: existingRun.warnings };

  const createdFiles = await stageImages(inspectedImages);
  try {
    await olimen.query('BEGIN');
    await olimen.query("SELECT pg_advisory_xact_lock(hashtext('erp_universal_commercial_history_import'))");
    const protectedBefore = await getProtectedCounts(olimen);
    const modernBefore = (await olimen.query(`SELECT COUNT(*)::int quotes,
      COALESCE(MAX(commercial_number),0)::bigint max_number FROM commercial_quotes`)).rows[0];
    const counterBefore = (await olimen.query("SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key='global' FOR UPDATE")).rows[0];
    if (!counterBefore || Number(counterBefore.last_value) < 250) throw new Error('MODERN_COUNTER_INVALID');
    const run = (await olimen.query(`INSERT INTO integration_import_runs(source_system,import_type,status,source_snapshot_at,source_payload_hash)
      VALUES($1,$2,'running',NOW(),$3) RETURNING *`, [SOURCE_SYSTEM,IMPORT_TYPE,model.sourcePayloadHash])).rows[0];

    const productIdMap = new Map();
    let productsCreated = 0; let productsReused = 0;
    const productNameGroups = groupBy(model.productModels, 'commercialName');
    const potentialDuplicateNames = [...productNameGroups.values()].filter((group) => group.length > 1).map((group) => group.map((p) => p.id));
    for (const product of model.productModels) {
      const existing = (await olimen.query(`SELECT * FROM commercial_products WHERE source_system=$1 AND source_id=$2`, [SOURCE_SYSTEM,String(product.id)])).rows[0];
      let destination; let action;
      if (existing) {
        if (existing.source_payload_hash && existing.source_payload_hash !== product.payloadHash) throw new Error(`COMMERCIAL_PRODUCT_SOURCE_CHANGED:${product.id}`);
        destination = existing; action = 'reused'; productsReused += 1;
      } else {
        destination = (await olimen.query(`INSERT INTO commercial_products(name,commercial_code,is_active,commercial_description,
          operational_product_id,source_system,source_id,source_payload_hash,imported_at,import_run_id)
          VALUES($1,$2,$3,$4,NULL,$5,$6,$7,NOW(),$8) RETURNING *`,
        [product.commercialName,clean(product.sku),product.status !== 'inativo',clean(product.descricao),SOURCE_SYSTEM,String(product.id),product.payloadHash,run.id])).rows[0];
        action = 'created'; productsCreated += 1;
      }
      productIdMap.set(String(product.id), destination.id);
      await recordLedger(olimen, run.id, { entityType:'commercial_product',sourceId:product.id,destinationTable:'commercial_products',destinationId:destination.id,action,fingerprint:product.payloadHash });
    }
    for (const manual of model.manualProducts) {
      const payloadHash = hashObject({ name: manual.name, item_ids: manual.itemIds });
      const existing = (await olimen.query(`SELECT * FROM commercial_products WHERE source_system=$1 AND source_id=$2`, [SOURCE_SYSTEM,manual.sourceId])).rows[0];
      let destination; let action;
      if (existing) { destination=existing; action='reused'; productsReused += 1; }
      else {
        destination=(await olimen.query(`INSERT INTO commercial_products(name,is_active,operational_product_id,source_system,source_id,
          source_payload_hash,imported_at,import_run_id) VALUES($1,TRUE,NULL,$2,$3,$4,NOW(),$5) RETURNING *`,
        [manual.name,SOURCE_SYSTEM,manual.sourceId,payloadHash,run.id])).rows[0]; action='created'; productsCreated += 1;
      }
      productIdMap.set(manual.sourceId,destination.id);
      await recordLedger(olimen,run.id,{entityType:'commercial_product_manual',sourceId:manual.sourceId,destinationTable:'commercial_products',destinationId:destination.id,action,fingerprint:payloadHash,metadata:{source_item_ids:manual.itemIds}});
    }

    const versionIdMap = new Map();
    let technicalCatalogs=0; let catalogsCreated=0; let catalogsReused=0; let versionsCreated=0;
    let imagesCreated=0; let specificationsCreated=0; let includedCreated=0;
    const inspectedById = new Map(inspectedImages.map((row) => [row.id,row]));
    for (const product of model.productModels) {
      const commercialProductId = productIdMap.get(String(product.id));
      const sourceCatalog = product.catalog;
      const needsBase = Number(product.preco_venda) > 0 || sourceCatalog;
      if (!needsBase) continue;
      let catalog = (await olimen.query('SELECT * FROM product_catalogs WHERE commercial_product_id=$1 FOR UPDATE', [commercialProductId])).rows[0];
      const catalogHash = hashObject({ product_id:product.id,price:Number(product.preco_venda)>0?money(product.preco_venda):null,catalog:sourceCatalog });
      if (catalog && catalog.source_system && (catalog.source_system !== SOURCE_SYSTEM || catalog.source_id !== String(product.id))) {
        throw new Error(`CATALOG_OWNER_CONFLICT:${product.id}`);
      }
      if (!catalog) {
        catalog=(await olimen.query(`INSERT INTO product_catalogs(commercial_product_id,reference_price,commercial_description,
          source_system,source_id,source_catalog_id,source_payload_hash,imported_at,import_run_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),$8) RETURNING *`,
        [commercialProductId,Number(product.preco_venda)>0?money(product.preco_venda):null,clean(product.activeVersion?.descricao_comercial)||clean(product.descricao),
          SOURCE_SYSTEM,String(product.id),sourceCatalog?String(sourceCatalog.id):null,catalogHash,run.id])).rows[0]; catalogsCreated += 1;
      } else { catalogsReused += 1; }
      await recordLedger(olimen,run.id,{entityType:'product_catalog',sourceId:product.id,destinationTable:'product_catalogs',destinationId:catalog.id,action:catalog.import_run_id===run.id?'created':'reused',fingerprint:catalogHash,metadata:{source_catalog_id:sourceCatalog?.id||null}});
      if (!sourceCatalog) continue;
      technicalCatalogs += 1;
      let activeDestinationVersion = null;
      for (const version of sourceCatalog.versions) {
        const versionHash = hashObject(version);
        let destination = (await olimen.query(`SELECT * FROM product_catalog_versions WHERE source_system=$1 AND source_id=$2`,[SOURCE_SYSTEM,String(version.id)])).rows[0];
        if (!destination) {
          destination=(await olimen.query(`INSERT INTO product_catalog_versions(product_catalog_id,version_number,status,commercial_title,
            subtitle,presentation_text,applications_text,additional_text,notes,published_at,created_at,updated_at,
            source_system,source_id,source_payload_hash,imported_at,import_run_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13,$14,NOW(),$15) RETURNING *`,
          [catalog.id,version.versao,version.ativo?'published':'archived',version.nome_comercial,clean(version.subtitulo),
            clean(version.descricao_comercial),clean(version.aplicacoes),clean(version.observacoes),version.updated_at||version.created_at,
            version.created_at,version.updated_at,SOURCE_SYSTEM,String(version.id),versionHash,run.id])).rows[0]; versionsCreated += 1;
          for (const spec of version.specifications) {
            const inserted=(await olimen.query(`INSERT INTO product_catalog_specifications(product_catalog_version_id,name,value,position)
              VALUES($1,$2,$3,$4) RETURNING id`,[destination.id,spec.nome,spec.valor,spec.ordem])).rows[0];
            specificationsCreated += 1;
            await recordLedger(olimen,run.id,{entityType:'catalog_specification',sourceId:spec.id,destinationTable:'product_catalog_specifications',destinationId:inserted.id,action:'created',fingerprint:hashObject(spec)});
          }
          for (const included of version.includedItems) {
            const inserted=(await olimen.query(`INSERT INTO product_catalog_included_items(product_catalog_version_id,description,position)
              VALUES($1,$2,$3) RETURNING id`,[destination.id,included.descricao,included.ordem])).rows[0];
            includedCreated += 1;
            await recordLedger(olimen,run.id,{entityType:'catalog_included_item',sourceId:included.id,destinationTable:'product_catalog_included_items',destinationId:inserted.id,action:'created',fingerprint:hashObject(included)});
          }
          for (const image of version.images) {
            const file=inspectedById.get(image.id);
            const inserted=(await olimen.query(`INSERT INTO product_catalog_images(product_catalog_version_id,original_name,stored_name,
              mime_type,size_bytes,caption,position,is_primary,source_system,source_id,source_path,sha256,import_run_id)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [destination.id,path.basename(file.absolute),file.storedName,file.mimeType,file.byteSize,clean(image.legenda),image.ordem,
              Boolean(image.imagem_principal),SOURCE_SYSTEM,String(image.id),image.caminho_imagem,file.sha256,run.id])).rows[0];
            imagesCreated += 1;
            await recordLedger(olimen,run.id,{entityType:'catalog_image',sourceId:image.id,destinationTable:'product_catalog_images',destinationId:inserted.id,action:'created',fingerprint:file.sha256,metadata:{source_path:image.caminho_imagem}});
          }
        }
        versionIdMap.set(String(version.id),destination.id);
        if (version.ativo) activeDestinationVersion=destination.id;
        await recordLedger(olimen,run.id,{entityType:'product_catalog_version',sourceId:version.id,destinationTable:'product_catalog_versions',destinationId:destination.id,action:destination.import_run_id===run.id?'created':'reused',fingerprint:versionHash});
      }
      if (activeDestinationVersion && !catalog.active_version_id) await olimen.query('UPDATE product_catalogs SET active_version_id=$1 WHERE id=$2',[activeDestinationVersion,catalog.id]);
      else if (activeDestinationVersion && catalog.active_version_id !== activeDestinationVersion) throw new Error(`CATALOG_ACTIVE_VERSION_CONFLICT:${product.id}`);
    }

    const existingLegacyCount = Number((await olimen.query('SELECT COUNT(*)::int total FROM commercial_legacy_quotes')).rows[0].total);
    if (existingLegacyCount) throw new Error('LEGACY_HISTORY_ALREADY_EXISTS_WITH_DIFFERENT_SNAPSHOT');
    const legacyMap = [];
    const paymentType = { dinheiro:'cash',pix:'pix',cartao_debito:'debit_card',cartao_credito:'credit_card',boleto:'bank_slip',cheque:'check',transferencia:'bank_transfer',outro:'other' };
    for (const quote of model.canonicalQuotes) {
      const result=(await olimen.query(`INSERT INTO commercial_legacy_quotes(legacy_number,source_system,source_id,source_legacy_number,
        source_status,source_created_at,quote_date,customer_id,source_customer_id,customer_name_snapshot,customer_snapshot,
        notes_snapshot,item_count,items_gross_total,items_discount_total,subtotal,general_discount_amount,freight_amount,total,
        payment_total,calculation_version,total_provenance,payload_hash,import_run_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [quote.legacyNumber,SOURCE_SYSTEM,String(quote.id),quote.id,quote.status,quote.criado_em,quote.data_orcamento,
        quote.cliente_id==null?null:String(quote.cliente_id),quote.cliente_nome,
        {schema_version:1,name:quote.cliente_nome,source_customer_id:quote.cliente_id,provenance:'ERP_UNIVERSAL_SNAPSHOT'},
        clean(quote.observacoes),quote.items.length,quote.totals.gross,quote.totals.item_discount,quote.totals.subtotal,
        money(quote.desconto_geral),quote.totals.total,quote.totals.payment_total,CALCULATION_VERSION,TOTAL_PROVENANCE,quote.fingerprint,run.id])).rows[0];
      legacyMap.push({legacy_number:quote.legacyNumber,source_legacy_number:quote.id,id:result.id});
      const allSources=[quote,...quote.aliases];
      for (const alias of allSources) {
        await olimen.query(`INSERT INTO commercial_legacy_quote_source_aliases(commercial_legacy_quote_id,source_system,source_id,
          source_legacy_number,is_primary,fingerprint,import_run_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [result.id,SOURCE_SYSTEM,String(alias.id),alias.id,alias.id===quote.id,quote.fingerprint,run.id]);
        await recordLedger(olimen,run.id,{entityType:'legacy_quote',sourceId:alias.id,sourceLegacyNumber:alias.id,destinationTable:'commercial_legacy_quotes',
          destinationId:result.id,action:alias.id===quote.id?'created':'deduplicated',fingerprint:quote.fingerprint,canonicalSourceId:quote.id,
          metadata:{legacy_number:quote.legacyNumber}});
      }
      for (const [index,item] of quote.items.entries()) {
        const name=clean(item.nome_customizado)||clean(item.source_product_name)||clean(item.descricao)||`Item ERP ${item.id}`;
        const description=clean(item.descricao)||clean(item.source_product_description);
        const manualKey=item.produto_id==null?model.manualMap.get(normalizedName(name))?.sourceId:null;
        const commercialProductId=item.produto_id==null?productIdMap.get(manualKey):productIdMap.get(String(item.produto_id));
        await olimen.query(`INSERT INTO commercial_legacy_quote_items(commercial_legacy_quote_id,source_item_id,line_order,
          source_product_id,commercial_product_id,product_code_snapshot,product_name_snapshot,measurement_unit_snapshot,
          description_snapshot,quantity,unit_price,unit_discount_amount,discount_percent,gross_subtotal,discount_amount,subtotal,
          legacy_include_catalog,source_catalog_version_id,snapshot_provenance,import_run_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [result.id,String(item.id),index+1,item.produto_id==null?null:String(item.produto_id),commercialProductId,item.source_product_code,
          name,item.source_product_unit,description,item.quantidade,money(item.preco_unitario),money(item.desconto_valor),money(item.desconto_percentual),
          money(item.gross_subtotal),money(item.calculated_discount),money(item.calculated_subtotal),Boolean(item.incluir_catalogo),
          item.catalogo_versao_id==null?null:String(item.catalogo_versao_id),item.descricao?'ERP_ITEM':'ERP_PRODUCT_AT_EXTRACTION',run.id]);
      }
      for (const [index,payment] of quote.payments.entries()) {
        const inserted=(await olimen.query(`INSERT INTO commercial_legacy_quote_payment_methods(commercial_legacy_quote_id,
          source_payment_id,line_order,legacy_method,method_type,description,amount,installment_count,import_run_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [result.id,String(payment.id),index+1,payment.forma,paymentType[payment.forma]||'other',payment.forma,
          money(payment.valor),payment.parcelas,run.id])).rows[0];
        for (const installment of payment.installments) await olimen.query(`INSERT INTO commercial_legacy_quote_installments(
          legacy_payment_method_id,source_installment_id,installment_number,due_date,amount,import_run_id)
          VALUES($1,$2,$3,$4,$5,$6)`,[inserted.id,String(installment.id),installment.numero_parcela,installment.data_vencimento,money(installment.valor),run.id]);
      }
      await olimen.query('UPDATE commercial_legacy_quotes SET locked_at=NOW() WHERE id=$1',[result.id]);
    }

    const validation=(await olimen.query(`SELECT COUNT(*)::int quotes,MIN(legacy_number)::int minimum,MAX(legacy_number)::int maximum,
      COUNT(DISTINCT legacy_number)::int distinct_numbers,COALESCE(SUM(item_count),0)::int items,
      COALESCE(SUM(items_gross_total),0)::numeric(20,2) gross,
      COALESCE(SUM(items_discount_total),0)::numeric(20,2) item_discount,
      COALESCE(SUM(general_discount_amount),0)::numeric(20,2) general_discount,
      COALESCE(SUM(total),0)::numeric(20,2) total,
      COALESCE(SUM(payment_total),0)::numeric(20,2) payments
      FROM commercial_legacy_quotes`)).rows[0];
    const expectedUnique={quotes:model.canonicalQuotes.length,minimum:1,maximum:model.canonicalQuotes.length,
      distinct_numbers:model.canonicalQuotes.length,items:model.uniqueTotals.items,gross:money(model.uniqueTotals.gross),
      item_discount:money(model.uniqueTotals.itemDiscount),general_discount:money(model.uniqueTotals.generalDiscount),
      total:money(model.uniqueTotals.total),payments:money(model.uniqueTotals.payments)};
    for (const [key,value] of Object.entries(expectedUnique)) if (String(validation[key])!==String(value)) throw new Error(`POST_IMPORT_MISMATCH:${key}:${validation[key]}:${value}`);
    const unlinkedItems=Number((await olimen.query('SELECT COUNT(*)::int total FROM commercial_legacy_quote_items WHERE commercial_product_id IS NULL')).rows[0].total);
    if (unlinkedItems) throw new Error(`POST_IMPORT_UNLINKED_ITEMS:${unlinkedItems}`);
    const protectedAfter=await getProtectedCounts(olimen);
    for (const [table,count] of Object.entries(protectedBefore)) if (protectedAfter[table]!==count) throw new Error(`OPERATIONAL_SIDE_EFFECT:${table}:${count}:${protectedAfter[table]}`);
    const modernAfter=(await olimen.query(`SELECT COUNT(*)::int quotes,COALESCE(MAX(commercial_number),0)::bigint max_number FROM commercial_quotes`)).rows[0];
    const counterAfter=(await olimen.query("SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key='global'")).rows[0];
    if (String(modernAfter.quotes)!==String(modernBefore.quotes)||String(modernAfter.max_number)!==String(modernBefore.max_number)
      ||String(counterAfter.last_value)!==String(counterBefore.last_value)) throw new Error('MODERN_NUMBERING_CHANGED');

    const stats={raw_quotes:model.quoteModels.length,duplicate_groups:model.duplicateGroups,discarded_quotes:model.quoteModels.length-model.canonicalQuotes.length,
      imported_quotes:model.canonicalQuotes.length,legacy_first:1,legacy_last:model.canonicalQuotes.length,items:model.uniqueTotals.items,
      raw_financials:{gross:money(model.rawTotals.gross),item_discount:money(model.rawTotals.itemDiscount),general_discount:money(model.rawTotals.generalDiscount),total:money(model.rawTotals.total),payments:money(model.rawTotals.payments)},
      imported_financials:{gross:expectedUnique.gross,item_discount:expectedUnique.item_discount,general_discount:expectedUnique.general_discount,total:expectedUnique.total,payments:expectedUnique.payments},
      products_found:model.productModels.length+model.manualProducts.length,products_created:productsCreated,products_reused:productsReused,
      products_without_operational_link:model.productModels.length+model.manualProducts.length,technical_catalogs:technicalCatalogs,
      catalog_bases_created:catalogsCreated,catalog_bases_reused:catalogsReused,catalog_versions_created:versionsCreated,
      images_created:imagesCreated,unique_image_files:new Set(inspectedImages.map((row)=>row.sha256)).size,
      specifications_created:specificationsCreated,included_items_created:includedCreated,unlinked_items:unlinkedItems,
      modern_counter_unchanged:Number(counterAfter.last_value),mapping:legacyMap};
    const warnings=[
      {code:'NO_OFFICIAL_LEGACY_PDFS',count:model.canonicalQuotes.length},
      {code:'QUOTE_WITHOUT_PAYMENT',source_legacy_number:4},
      {code:'POTENTIAL_DUPLICATE_PRODUCT_NAMES_PRESERVED',groups:potentialDuplicateNames},
      {code:'UNREFERENCED_CATALOG_VERSIONS_PRESERVED',source_version_ids:model.versions.filter((v)=>!model.items.some((i)=>i.catalogo_versao_id===v.id)).map((v)=>v.id)},
    ];
    await olimen.query(`UPDATE integration_import_runs SET status='completed',stats=$1,warnings=$2,completed_at=NOW() WHERE id=$3`,[JSON.stringify(stats),JSON.stringify(warnings),run.id]);
    await olimen.query('COMMIT');
    return {idempotent_reuse:false,import_run_id:run.id,stats,warnings};
  } catch (error) {
    await olimen.query('ROLLBACK').catch(()=>{});
    for (const file of createdFiles) await fs.unlink(file).catch(()=>{});
    throw error;
  }
}

try {
  await Promise.all([erp.connect(),olimen.connect()]);
  const source=await loadSource();
  const model=buildModel(source);
  const reference=assertPreflight(model);
  const inspectedImages=await inspectImages(model);
  const preflight={mode,source_system:SOURCE_SYSTEM,source_payload_hash:model.sourcePayloadHash,reference,
    unique_quotes:model.canonicalQuotes.length,discarded_quotes:model.quoteModels.length-model.canonicalQuotes.length,
    duplicate_groups:model.duplicateGroups,unique_items:model.uniqueTotals.items,
    unique_financials:{gross:money(model.uniqueTotals.gross),item_discount:money(model.uniqueTotals.itemDiscount),
      general_discount:money(model.uniqueTotals.generalDiscount),total:money(model.uniqueTotals.total),payments:money(model.uniqueTotals.payments)},
    source_products:model.productModels.length,manual_products:model.manualProducts.length,commercial_products:model.productModels.length+model.manualProducts.length,
    technical_catalogs:model.catalogs.length,catalog_versions:model.versions.length,images:model.images.length,
    unique_image_files:new Set(inspectedImages.map((row)=>row.sha256)).size,specifications:model.specifications.length,included_items:model.includedItems.length,
    blockers:[]};
  if (mode==='--preflight') console.log(JSON.stringify(preflight,null,2));
  else console.log(JSON.stringify({...preflight,result:await importData(model,inspectedImages)},null,2));
} finally {
  await erp.query('ROLLBACK').catch(()=>{});
  await Promise.allSettled([erp.end(),olimen.end()]);
}
