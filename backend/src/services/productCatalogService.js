import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { logAudit } from './auditService.js';
import { hasPermission } from './permissionService.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const uploadRoot = path.resolve(process.env.CATALOG_IMAGE_UPLOAD_DIR || path.join(projectRoot, 'uploads', 'commercial-catalog'));
const maxBytes = Number(process.env.CATALOG_IMAGE_MAX_BYTES || 8 * 1024 * 1024);
const allowedMimes = new Map([['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp']]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value, field = 'id') {
  if (!UUID_PATTERN.test(String(value || ''))) throw httpError(400, 'Identificador inválido.', { field });
}

function text(value, max, field, required = false) {
  const result = value == null ? '' : String(value).trim();
  if (required && !result) throw httpError(400, `Informe ${field}.`, { field });
  if (max && result.length > max) throw httpError(400, `${field} excede ${max} caracteres.`, { field });
  return result || null;
}

function money(value, field, nullable = true) {
  if (value === '' || value == null) {
    if (nullable) return null;
    throw httpError(400, `Informe ${field}.`, { field });
  }
  if (!/^\d{1,12}(?:[.,]\d{1,4})?$/.test(String(value).trim())) throw httpError(400, `Valor inválido em ${field}.`, { field });
  return String(value).trim().replace(',', '.');
}

export function calculateSop(referencePrice, discountType, discountValue) {
  if (referencePrice == null || discountType == null || discountValue == null) return null;
  const referenceCents = BigInt(Math.round(Number(referencePrice) * 100));
  let discountCents;
  if (discountType === 'amount') discountCents = BigInt(Math.round(Number(discountValue) * 100));
  else if (discountType === 'percentage') discountCents = (referenceCents * BigInt(Math.round(Number(discountValue) * 10000)) + 500000n) / 1000000n;
  else throw httpError(400, 'Tipo de desconto SOP inválido.', { field: 'sop_discount_type' });
  const minimum = referenceCents > discountCents ? referenceCents - discountCents : 0n;
  return { minimum_price: `${minimum / 100n}.${String(minimum % 100n).padStart(2, '0')}` };
}

function normalizeBase(payload, allowSop) {
  const referencePrice = money(payload.reference_price, 'reference_price');
  let sopType = payload.sop_discount_type || null;
  let sopValue = money(payload.sop_discount_value, 'sop_discount_value');
  if (!allowSop && (payload.sop_discount_type !== undefined || payload.sop_discount_value !== undefined)) {
    throw httpError(403, 'Você não possui permissão para alterar a SOP Comercial.');
  }
  if (!allowSop) { sopType = undefined; sopValue = undefined; }
  if (allowSop) {
    if ((sopType == null) !== (sopValue == null)) throw httpError(400, 'Informe tipo e limite da SOP juntos.', { field: 'sop_discount_value' });
    if (sopType && !['amount', 'percentage'].includes(sopType)) throw httpError(400, 'Tipo de desconto SOP inválido.', { field: 'sop_discount_type' });
    if (sopType === 'percentage' && Number(sopValue) > 100) throw httpError(400, 'O desconto percentual não pode superar 100%.', { field: 'sop_discount_value' });
    if (sopType && referencePrice == null) throw httpError(400, 'Informe o preço de referência antes da SOP.', { field: 'reference_price' });
  }
  return { referencePrice, commercialDescription: text(payload.commercial_description, null, 'commercial_description'), sopType, sopValue };
}

function normalizeVersion(payload, fallbackTitle) {
  const specifications = Array.isArray(payload.specifications) ? payload.specifications.map((item, index) => ({
    name: text(item.name, 180, `specifications.${index}.name`, true), value: text(item.value, null, `specifications.${index}.value`, true),
    unit: text(item.unit, 40, `specifications.${index}.unit`), position: index,
  })) : [];
  const includedItems = Array.isArray(payload.included_items) ? payload.included_items.map((item, index) => ({
    description: text(item.description, null, `included_items.${index}.description`, true),
    quantity: item.quantity === '' || item.quantity == null ? null : money(item.quantity, `included_items.${index}.quantity`, false),
    unit: text(item.unit, 40, `included_items.${index}.unit`), notes: text(item.notes, null, `included_items.${index}.notes`), position: index,
  })) : [];
  return {
    commercial_title: text(payload.commercial_title || fallbackTitle, 220, 'commercial_title', true),
    subtitle: text(payload.subtitle, null, 'subtitle'), presentation_text: text(payload.presentation_text, null, 'presentation_text'),
    applications_text: text(payload.applications_text, null, 'applications_text'), additional_text: text(payload.additional_text, null, 'additional_text'),
    notes: text(payload.notes, null, 'notes'), specifications, includedItems,
  };
}

async function replaceChildren(client, versionId, version) {
  await client.query('DELETE FROM product_catalog_specifications WHERE product_catalog_version_id=$1', [versionId]);
  await client.query('DELETE FROM product_catalog_included_items WHERE product_catalog_version_id=$1', [versionId]);
  for (const item of version.specifications) await client.query(
    `INSERT INTO product_catalog_specifications(product_catalog_version_id,name,value,unit,position) VALUES($1,$2,$3,$4,$5)`,
    [versionId, item.name, item.value, item.unit, item.position],
  );
  for (const item of version.includedItems) await client.query(
    `INSERT INTO product_catalog_included_items(product_catalog_version_id,description,quantity,unit,notes,position) VALUES($1,$2,$3,$4,$5,$6)`,
    [versionId, item.description, item.quantity, item.unit, item.notes, item.position],
  );
}

async function loadVersionChildren(database, versions) {
  const ids = versions.map((version) => version.id);
  if (!ids.length) return versions;
  // Também funciona com o mesmo pg.Client dentro de uma transação; consultas no
  // mesmo client são intencionalmente sequenciais.
  const images = await database.query('SELECT * FROM product_catalog_images WHERE product_catalog_version_id=ANY($1::uuid[]) ORDER BY position,id', [ids]);
  const specifications = await database.query('SELECT * FROM product_catalog_specifications WHERE product_catalog_version_id=ANY($1::uuid[]) ORDER BY position,id', [ids]);
  const included = await database.query('SELECT * FROM product_catalog_included_items WHERE product_catalog_version_id=ANY($1::uuid[]) ORDER BY position,id', [ids]);
  return versions.map((version) => ({ ...version,
    images: images.rows.filter((item) => item.product_catalog_version_id === version.id).map((item) => ({ ...item, image_url: `/api/commercial/catalog/images/${item.id}/content` })),
    specifications: specifications.rows.filter((item) => item.product_catalog_version_id === version.id),
    included_items: included.rows.filter((item) => item.product_catalog_version_id === version.id),
  }));
}

function concealSop(catalog, user) {
  if (hasPermission(user, 'commercial.catalog.sop.view')) return catalog;
  return { ...catalog, sop_discount_type: undefined, sop_discount_value: undefined, sop_minimum_price: undefined };
}

export async function listCatalogs(params = {}, user) {
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit, 10) || 20));
  const search = text(params.search, 160, 'search') || '';
  const configured = String(params.configured || '');
  const status = String(params.status || 'active');
  const values = [`%${search}%`];
  const filters = ["($1='' OR cp.name ILIKE $1 OR COALESCE(cp.commercial_code,'') ILIKE $1)"];
  if (status === 'active') filters.push('cp.is_active=TRUE');
  if (status === 'inactive') filters.push('cp.is_active=FALSE');
  if (configured === 'yes') filters.push('EXISTS(SELECT 1 FROM product_catalog_versions cv WHERE cv.product_catalog_id=c.id)');
  if (configured === 'no') filters.push('NOT EXISTS(SELECT 1 FROM product_catalog_versions cv WHERE cv.product_catalog_id=c.id)');
  const where = filters.join(' AND ');
  const count = await pool.query(`SELECT COUNT(*)::int total FROM commercial_products cp LEFT JOIN product_catalogs c ON c.commercial_product_id=cp.id WHERE ${where}`, values);
  values.push(limit, (page - 1) * limit);
  const result = await pool.query(
    `SELECT cp.id AS commercial_product_id,cp.name AS product_name,cp.name AS commercial_name,
      cp.commercial_code AS internal_code,cp.commercial_code,cp.commercial_description,
      cp.is_active,cp.source_system,cp.source_id,cp.operational_product_id,p.name AS operational_product_name,p.internal_code AS operational_product_code,
      EXISTS(SELECT 1 FROM product_images pi WHERE pi.product_id=p.id) AS has_operational_photo,
      c.id,c.reference_price,c.commercial_description,c.sop_discount_type,c.sop_discount_value,c.active_version_id,c.updated_at,
      v.version_number AS active_version_number,v.commercial_title AS active_version_title,
      image.id AS commercial_image_id,
      EXISTS(SELECT 1 FROM product_catalog_versions cv WHERE cv.product_catalog_id=c.id) AS catalog_configured
     FROM commercial_products cp
     LEFT JOIN products p ON p.id=cp.operational_product_id
     LEFT JOIN product_catalogs c ON c.commercial_product_id=cp.id
     LEFT JOIN product_catalog_versions v ON v.id=c.active_version_id
     LEFT JOIN LATERAL (SELECT id FROM product_catalog_images WHERE product_catalog_version_id=v.id ORDER BY is_primary DESC,position,id LIMIT 1) image ON TRUE
     WHERE ${where} ORDER BY cp.is_active DESC,cp.name LIMIT $2 OFFSET $3`, values,
  );
  return { items: result.rows.map((row) => concealSop({ ...row, sop_minimum_price: calculateSop(row.reference_price, row.sop_discount_type, row.sop_discount_value)?.minimum_price || null }, user)),
    pagination: { page, limit, total: count.rows[0].total, total_pages: Math.max(1, Math.ceil(count.rows[0].total / limit)) } };
}

export async function getCatalogByCommercialProduct(commercialProductId, user, database = pool) {
  assertUuid(commercialProductId, 'commercial_product_id');
  const result = await database.query(
    `SELECT c.*,cp.id AS commercial_product_id,cp.name AS product_name,cp.name AS commercial_name,
      cp.commercial_code,cp.commercial_description AS product_commercial_description,cp.is_active,
      cp.operational_product_id,cp.source_system,cp.source_id,
      p.name AS operational_product_name,p.internal_code AS operational_product_code
     FROM commercial_products cp
     LEFT JOIN products p ON p.id=cp.operational_product_id
     LEFT JOIN product_catalogs c ON c.commercial_product_id=cp.id
     WHERE cp.id=$1`, [commercialProductId],
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, 'Produto Comercial não encontrado.');
  const base = {
    ...row,
    commercial_description: row.product_commercial_description,
    configured: Boolean(row.id),
    catalog_configured: false,
    versions: [],
  };
  if (!row.id) return concealSop(base, user);
  const versions = await database.query('SELECT * FROM product_catalog_versions WHERE product_catalog_id=$1 ORDER BY version_number DESC', [row.id]);
  const enriched = await loadVersionChildren(database, versions.rows);
  return concealSop({ ...base, catalog_configured: enriched.length > 0,
    sop_minimum_price: calculateSop(row.reference_price, row.sop_discount_type, row.sop_discount_value)?.minimum_price || null,
    versions: enriched }, user);
}

function normalizeCommercialProduct(payload) {
  return {
    name: text(payload.name ?? payload.commercial_name, 2000, 'nome comercial', true),
    commercialCode: text(payload.commercial_code, 80, 'código comercial'),
    commercialDescription: text(payload.commercial_description, null, 'descrição comercial'),
    operationalProductId: payload.operational_product_id || null,
    isActive: payload.is_active !== false,
  };
}

async function assertOperationalProduct(client, productId) {
  if (!productId) return null;
  assertUuid(productId, 'operational_product_id');
  const product = (await client.query('SELECT id,name,is_active FROM products WHERE id=$1', [productId])).rows[0];
  if (!product) throw httpError(400, 'Produto interno vinculado não encontrado.', { field: 'operational_product_id' });
  return product;
}

async function assertUniqueCommercialName(client, name, exceptId = null) {
  const duplicate = (await client.query(
    `SELECT id,name,commercial_code FROM commercial_products
     WHERE lower(btrim(name))=lower(btrim($1)) AND ($2::uuid IS NULL OR id<>$2)
     ORDER BY is_active DESC,updated_at DESC LIMIT 1`, [name, exceptId],
  )).rows[0];
  if (duplicate) throw httpError(409, 'Já existe um Produto Comercial com este nome. Reaproveite o cadastro existente ou altere o nome.', {
    code: 'COMMERCIAL_PRODUCT_DUPLICATE', details: { duplicate },
  });
}

async function upsertCommercialBase(client, commercialProductId, payload, user, existing = null) {
  const supplied = ['reference_price', 'sop_discount_type', 'sop_discount_value'].some((field) => payload[field] !== undefined);
  if (!supplied && !existing) return null;
  const allowSop = hasPermission(user, 'commercial.catalog.sop.edit');
  const normalizedPayload = existing ? {
    ...payload,
    reference_price: payload.reference_price === undefined ? existing.reference_price : payload.reference_price,
    ...(allowSop ? {
      sop_discount_type: payload.sop_discount_type === undefined ? existing.sop_discount_type : payload.sop_discount_type,
      sop_discount_value: payload.sop_discount_value === undefined ? existing.sop_discount_value : payload.sop_discount_value,
    } : {}),
  } : payload;
  const base = normalizeBase(normalizedPayload, allowSop);
  if (existing) {
    const sopType = allowSop ? base.sopType : existing.sop_discount_type;
    const sopValue = allowSop ? base.sopValue : existing.sop_discount_value;
    return (await client.query(
      `UPDATE product_catalogs SET reference_price=$1,commercial_description=$2,sop_discount_type=$3,
        sop_discount_value=$4,updated_by=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
      [base.referencePrice, payload.commercial_description === undefined ? existing.commercial_description : base.commercialDescription,
        sopType, sopValue, user.id, existing.id],
    )).rows[0];
  }
  return (await client.query(
    `INSERT INTO product_catalogs(commercial_product_id,reference_price,commercial_description,sop_discount_type,sop_discount_value,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
    [commercialProductId, base.referencePrice, base.commercialDescription, base.sopType, base.sopValue, user.id],
  )).rows[0];
}

export async function createCommercialProduct(payload, user) {
  return transaction(async (client) => {
    const normalized = normalizeCommercialProduct(payload);
    await assertUniqueCommercialName(client, normalized.name);
    await assertOperationalProduct(client, normalized.operationalProductId);
    const created = (await client.query(
      `INSERT INTO commercial_products(name,commercial_code,is_active,commercial_description,operational_product_id,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
      [normalized.name, normalized.commercialCode, normalized.isActive, normalized.commercialDescription,
        normalized.operationalProductId, user.id],
    )).rows[0];
    await upsertCommercialBase(client, created.id, { ...payload, commercial_description: normalized.commercialDescription }, user);
    await logAudit(client, { entityType: 'commercial_product', entityId: created.id, action: 'create',
      newValue: { name: created.name, operational_product_id: created.operational_product_id }, userId: user.id });
    return getCatalogByCommercialProduct(created.id, user, client);
  });
}

export async function updateCommercialProduct(id, payload, user) {
  assertUuid(id, 'commercial_product_id');
  return transaction(async (client) => {
    const current = (await client.query('SELECT * FROM commercial_products WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!current) throw httpError(404, 'Produto Comercial não encontrado.');
    const normalized = normalizeCommercialProduct({ ...current, ...payload });
    await assertUniqueCommercialName(client, normalized.name, id);
    await assertOperationalProduct(client, normalized.operationalProductId);
    await client.query(
      `UPDATE commercial_products SET name=$1,commercial_code=$2,is_active=$3,commercial_description=$4,
        operational_product_id=$5,updated_by=$6,updated_at=NOW() WHERE id=$7`,
      [normalized.name, normalized.commercialCode, normalized.isActive, normalized.commercialDescription,
        normalized.operationalProductId, user.id, id],
    );
    const existing = (await client.query('SELECT * FROM product_catalogs WHERE commercial_product_id=$1 FOR UPDATE', [id])).rows[0];
    await upsertCommercialBase(client, id, { ...payload, commercial_description: normalized.commercialDescription }, user, existing);
    await logAudit(client, { entityType: 'commercial_product', entityId: id, action: 'update', previousValue: current,
      newValue: { name: normalized.name, operational_product_id: normalized.operationalProductId, is_active: normalized.isActive }, userId: user.id });
    return getCatalogByCommercialProduct(id, user, client);
  });
}

export async function listOperationalProductOptions(search = '') {
  const value = text(search, 160, 'q') || '';
  return (await pool.query(
    `SELECT id,name,internal_code FROM products WHERE is_active=TRUE
     AND ($1='' OR name ILIKE '%'||$1||'%' OR COALESCE(internal_code,'') ILIKE '%'||$1||'%')
     ORDER BY name LIMIT 40`, [value],
  )).rows;
}

export async function getCatalogByProduct(productId, user, database = pool) {
  assertUuid(productId, 'product_id');
  const result = await database.query(
    `SELECT c.*,p.id AS product_id,p.name AS product_name,p.internal_code,p.measurement_unit_code,p.is_active AS product_is_active,
      EXISTS(SELECT 1 FROM product_images pi WHERE pi.product_id=p.id) AS has_operational_photo
     FROM products p LEFT JOIN product_catalogs c ON c.product_id=p.id WHERE p.id=$1`, [productId],
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, 'Produto não encontrado.');
  if (!row.id) return { product_id: row.product_id, product_name: row.product_name, internal_code: row.internal_code, measurement_unit_code: row.measurement_unit_code, product_is_active: row.product_is_active, configured: false };
  const versions = await database.query('SELECT * FROM product_catalog_versions WHERE product_catalog_id=$1 ORDER BY version_number DESC', [row.id]);
  const enriched = await loadVersionChildren(database, versions.rows);
  return concealSop({ ...row, configured: true, sop_minimum_price: calculateSop(row.reference_price, row.sop_discount_type, row.sop_discount_value)?.minimum_price || null, versions: enriched }, user);
}

export async function createCatalog(payload, user) {
  if (!payload.commercial_product_id && !payload.product_id) throw httpError(400, 'Informe o Produto Comercial.', { field: 'commercial_product_id' });
  if (payload.commercial_product_id) assertUuid(payload.commercial_product_id, 'commercial_product_id');
  if (payload.product_id) assertUuid(payload.product_id, 'product_id');
  return transaction(async (client) => {
    let commercialProduct;
    let product = null;
    if (payload.commercial_product_id) {
      commercialProduct = (await client.query('SELECT * FROM commercial_products WHERE id=$1 FOR UPDATE', [payload.commercial_product_id])).rows[0];
      if (!commercialProduct) throw httpError(404, 'Produto Comercial não encontrado.');
      if (!commercialProduct.is_active) throw httpError(409, 'Não é possível criar Catálogo Técnico para Produto Comercial inativo.');
      if (commercialProduct.operational_product_id) product = (await client.query('SELECT * FROM products WHERE id=$1', [commercialProduct.operational_product_id])).rows[0];
    } else {
      product = (await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [payload.product_id])).rows[0];
      if (!product) throw httpError(404, 'Produto não encontrado.');
      if (!product.is_active) throw httpError(409, 'Não é possível criar Catálogo para Produto inativo.');
      const existingCatalog = (await client.query('SELECT * FROM product_catalogs WHERE product_id=$1', [product.id])).rows[0];
      if (existingCatalog) throw httpError(409, 'Este Produto já possui Catálogo Comercial.');
      commercialProduct = (await client.query(
        `INSERT INTO commercial_products(name,commercial_code,operational_product_id,commercial_description,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$5) RETURNING *`,
        [product.name, product.internal_code, product.id, text(payload.commercial_description, null, 'commercial_description'), user.id],
      )).rows[0];
    }
    const base = normalizeBase(payload, hasPermission(user, 'commercial.catalog.sop.edit'));
    let catalog = (await client.query('SELECT * FROM product_catalogs WHERE commercial_product_id=$1 FOR UPDATE', [commercialProduct.id])).rows[0];
    if (catalog) {
      const versionCount = (await client.query('SELECT COUNT(*)::int total FROM product_catalog_versions WHERE product_catalog_id=$1', [catalog.id])).rows[0].total;
      if (versionCount) throw httpError(409, 'Este Produto Comercial já possui Catálogo Técnico.');
      catalog = (await client.query(
        `UPDATE product_catalogs SET reference_price=$1,commercial_description=$2,sop_discount_type=$3,sop_discount_value=$4,
          product_id=COALESCE(product_id,$5),updated_by=$6,updated_at=NOW() WHERE id=$7 RETURNING *`,
        [base.referencePrice, base.commercialDescription, base.sopType, base.sopValue, product?.id || null, user.id, catalog.id],
      )).rows[0];
    } else {
      catalog = (await client.query(
        `INSERT INTO product_catalogs(commercial_product_id,product_id,reference_price,commercial_description,sop_discount_type,sop_discount_value,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
        [commercialProduct.id, product?.id || null, base.referencePrice, base.commercialDescription, base.sopType, base.sopValue, user.id],
      )).rows[0];
    }
    const versionData = normalizeVersion(payload.version || {}, commercialProduct.name);
    const version = (await client.query(
      `INSERT INTO product_catalog_versions(product_catalog_id,version_number,commercial_title,subtitle,presentation_text,applications_text,additional_text,notes,created_by,updated_by)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [catalog.id, versionData.commercial_title, versionData.subtitle, versionData.presentation_text, versionData.applications_text, versionData.additional_text, versionData.notes, user.id],
    )).rows[0];
    await replaceChildren(client, version.id, versionData);
    await logAudit(client, { entityType: 'product_catalog', entityId: catalog.id, action: 'create', newValue: { commercial_product_id: commercialProduct.id, product_id: product?.id || null, version: 1 }, userId: user.id });
    return getCatalogByCommercialProduct(commercialProduct.id, user, client);
  }).catch((error) => { if (error.code === '23505') throw httpError(409, 'Este Produto Comercial já possui Catálogo.'); throw error; });
}

export async function updateCatalog(catalogId, payload, user) {
  assertUuid(catalogId);
  return transaction(async (client) => {
    const current = (await client.query('SELECT * FROM product_catalogs WHERE id=$1 FOR UPDATE', [catalogId])).rows[0];
    if (!current) throw httpError(404, 'Catálogo não encontrado.');
    const allowSop = hasPermission(user, 'commercial.catalog.sop.edit');
    const base = normalizeBase(payload, allowSop);
    const sopType = allowSop ? base.sopType : current.sop_discount_type;
    const sopValue = allowSop ? base.sopValue : current.sop_discount_value;
    await client.query(
      `UPDATE product_catalogs SET reference_price=$1,commercial_description=$2,sop_discount_type=$3,sop_discount_value=$4,updated_by=$5,updated_at=NOW() WHERE id=$6`,
      [base.referencePrice, base.commercialDescription, sopType, sopValue, user.id, catalogId],
    );
    await logAudit(client, { entityType: 'product_catalog', entityId: catalogId, action: 'update_commercial', previousValue: current, newValue: { reference_price: base.referencePrice, sop_discount_type: sopType, sop_discount_value: sopValue }, userId: user.id });
    return current.commercial_product_id
      ? getCatalogByCommercialProduct(current.commercial_product_id, user, client)
      : getCatalogByProduct(current.product_id, user, client);
  });
}

async function assertDraft(client, versionId) {
  const version = (await client.query('SELECT * FROM product_catalog_versions WHERE id=$1 FOR UPDATE', [versionId])).rows[0];
  if (!version) throw httpError(404, 'Versão não encontrada.');
  if (version.status !== 'draft') throw httpError(409, 'Versões publicadas ou históricas são imutáveis.', { code: 'CATALOG_VERSION_IMMUTABLE' });
  return version;
}

export async function updateCatalogVersion(versionId, payload, user) {
  assertUuid(versionId);
  return transaction(async (client) => {
    const current = await assertDraft(client, versionId);
    const catalog = (await client.query(`SELECT c.*,COALESCE(cp.name,p.name) product_name
      FROM product_catalogs c LEFT JOIN commercial_products cp ON cp.id=c.commercial_product_id
      LEFT JOIN products p ON p.id=c.product_id WHERE c.id=$1`, [current.product_catalog_id])).rows[0];
    const version = normalizeVersion(payload, catalog.product_name);
    await client.query(
      `UPDATE product_catalog_versions SET commercial_title=$1,subtitle=$2,presentation_text=$3,applications_text=$4,additional_text=$5,notes=$6,updated_by=$7,updated_at=NOW() WHERE id=$8`,
      [version.commercial_title, version.subtitle, version.presentation_text, version.applications_text, version.additional_text, version.notes, user.id, versionId],
    );
    await replaceChildren(client, versionId, version);
    await logAudit(client, { entityType: 'product_catalog_version', entityId: versionId, action: 'edit', previousValue: { version_number: current.version_number }, newValue: { version_number: current.version_number }, userId: user.id });
    return catalog.commercial_product_id
      ? getCatalogByCommercialProduct(catalog.commercial_product_id, user, client)
      : getCatalogByProduct(catalog.product_id, user, client);
  });
}

export async function createCatalogVersion(catalogId, user) {
  assertUuid(catalogId);
  return transaction(async (client) => {
    const catalog = (await client.query(`SELECT c.*,COALESCE(cp.name,p.name) product_name
      FROM product_catalogs c LEFT JOIN commercial_products cp ON cp.id=c.commercial_product_id
      LEFT JOIN products p ON p.id=c.product_id WHERE c.id=$1 FOR UPDATE OF c`, [catalogId])).rows[0];
    if (!catalog) throw httpError(404, 'Catálogo não encontrado.');
    const base = (await client.query('SELECT * FROM product_catalog_versions WHERE product_catalog_id=$1 ORDER BY version_number DESC LIMIT 1', [catalogId])).rows[0];
    const next = Number(base?.version_number || 0) + 1;
    const created = (await client.query(
      `INSERT INTO product_catalog_versions(product_catalog_id,version_number,commercial_title,subtitle,presentation_text,applications_text,additional_text,notes,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [catalogId, next, base?.commercial_title || catalog.product_name, base?.subtitle, base?.presentation_text, base?.applications_text, base?.additional_text, base?.notes, user.id],
    )).rows[0];
    if (base) {
      await client.query(`INSERT INTO product_catalog_specifications(product_catalog_version_id,name,value,unit,position) SELECT $1,name,value,unit,position FROM product_catalog_specifications WHERE product_catalog_version_id=$2`, [created.id, base.id]);
      await client.query(`INSERT INTO product_catalog_included_items(product_catalog_version_id,description,quantity,unit,notes,position) SELECT $1,description,quantity,unit,notes,position FROM product_catalog_included_items WHERE product_catalog_version_id=$2`, [created.id, base.id]);
      await client.query(`INSERT INTO product_catalog_images(product_catalog_version_id,original_name,stored_name,mime_type,size_bytes,caption,position,is_primary,uploaded_by) SELECT $1,original_name,stored_name,mime_type,size_bytes,caption,position,is_primary,$3 FROM product_catalog_images WHERE product_catalog_version_id=$2`, [created.id, base.id, user.id]);
    }
    await logAudit(client, { entityType: 'product_catalog_version', entityId: created.id, action: 'create_version', newValue: { version_number: next, source_version_id: base?.id || null }, userId: user.id });
    return catalog.commercial_product_id
      ? getCatalogByCommercialProduct(catalog.commercial_product_id, user, client)
      : getCatalogByProduct(catalog.product_id, user, client);
  });
}

export async function publishCatalogVersion(versionId, user) {
  assertUuid(versionId);
  return transaction(async (client) => {
    const version = await assertDraft(client, versionId);
    const catalog = (await client.query('SELECT * FROM product_catalogs WHERE id=$1 FOR UPDATE', [version.product_catalog_id])).rows[0];
    await client.query("UPDATE product_catalog_versions SET status='archived',updated_at=NOW() WHERE id=$1 AND status='published'", [catalog.active_version_id]);
    await client.query("UPDATE product_catalog_versions SET status='published',published_at=NOW(),published_by=$1,updated_by=$1,updated_at=NOW() WHERE id=$2", [user.id, versionId]);
    await client.query('UPDATE product_catalogs SET active_version_id=$1,updated_by=$2,updated_at=NOW() WHERE id=$3', [versionId, user.id, catalog.id]);
    await logAudit(client, { entityType: 'product_catalog_version', entityId: versionId, action: 'publish', newValue: { version_number: version.version_number }, userId: user.id });
    return catalog.commercial_product_id
      ? getCatalogByCommercialProduct(catalog.commercial_product_id, user, client)
      : getCatalogByProduct(catalog.product_id, user, client);
  });
}

function resolveStored(storedName) {
  if (!storedName || path.basename(storedName) !== storedName || storedName.includes('..')) throw httpError(400, 'Caminho de imagem inválido.');
  const resolved = path.resolve(uploadRoot, storedName);
  if (path.relative(uploadRoot, resolved).startsWith('..')) throw httpError(400, 'Caminho de imagem inválido.');
  return resolved;
}

function validateImage(buffer, mimeType, originalName) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError(400, 'Selecione uma imagem.');
  if (buffer.length > maxBytes) throw httpError(400, 'A imagem está acima do limite de 8 MB.');
  if (!allowedMimes.has(mimeType)) throw httpError(400, 'Formato não permitido. Use PNG, JPEG ou WebP.');
  if (!originalName || path.basename(originalName) !== originalName || /[\\/]/.test(originalName)) throw httpError(400, 'Nome de arquivo inválido.');
  if (mimeType === 'image/png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw httpError(400, 'Arquivo PNG inválido.');
  if (mimeType === 'image/jpeg' && !(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) throw httpError(400, 'Arquivo JPEG inválido.');
  if (mimeType === 'image/webp' && (buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WEBP')) throw httpError(400, 'Arquivo WebP inválido.');
}

export async function uploadCatalogImage(versionId, metadata, buffer, user) {
  assertUuid(versionId);
  validateImage(buffer, metadata.mimeType, metadata.originalName);
  const count = await pool.query('SELECT COUNT(*)::int total FROM product_catalog_images WHERE product_catalog_version_id=$1', [versionId]);
  if (count.rows[0].total >= 10) throw httpError(409, 'Cada versão aceita no máximo 10 imagens.');
  const storedName = `catalog-${randomUUID()}${allowedMimes.get(metadata.mimeType)}`;
  await fs.mkdir(uploadRoot, { recursive: true });
  await fs.writeFile(resolveStored(storedName), buffer, { flag: 'wx', mode: 0o600 });
  try {
    return await transaction(async (client) => {
      await assertDraft(client, versionId);
      const order = (await client.query('SELECT COALESCE(MAX(position),-1)+1 AS position,COUNT(*)::int total FROM product_catalog_images WHERE product_catalog_version_id=$1', [versionId])).rows[0];
      const image = (await client.query(
        `INSERT INTO product_catalog_images(product_catalog_version_id,original_name,stored_name,mime_type,size_bytes,caption,position,is_primary,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [versionId, metadata.originalName, storedName, metadata.mimeType, buffer.length, text(metadata.caption, null, 'caption'), order.position, order.total === 0, user.id],
      )).rows[0];
      await logAudit(client, { entityType: 'product_catalog_version', entityId: versionId, action: 'image_add', newValue: { image_id: image.id }, userId: user.id });
      return { ...image, image_url: `/api/commercial/catalog/images/${image.id}/content` };
    });
  } catch (error) { await fs.unlink(resolveStored(storedName)).catch(() => {}); throw error; }
}

export async function updateCatalogImage(imageId, payload, user) {
  assertUuid(imageId);
  return transaction(async (client) => {
    const image = (await client.query('SELECT * FROM product_catalog_images WHERE id=$1 FOR UPDATE', [imageId])).rows[0];
    if (!image) throw httpError(404, 'Imagem não encontrada.');
    await assertDraft(client, image.product_catalog_version_id);
    if (payload.is_primary === true) await client.query('UPDATE product_catalog_images SET is_primary=FALSE WHERE product_catalog_version_id=$1', [image.product_catalog_version_id]);
    const updated = (await client.query(
      `UPDATE product_catalog_images SET caption=$1,position=$2,is_primary=$3,updated_at=NOW() WHERE id=$4 RETURNING *`,
      [text(payload.caption, null, 'caption'), Math.max(0, Number.parseInt(payload.position, 10) || 0), payload.is_primary ?? image.is_primary, imageId],
    )).rows[0];
    await logAudit(client, { entityType: 'product_catalog_version', entityId: image.product_catalog_version_id, action: 'image_update', newValue: { image_id: imageId }, userId: user.id });
    return { ...updated, image_url: `/api/commercial/catalog/images/${updated.id}/content` };
  });
}

export async function deleteCatalogImage(imageId, user) {
  assertUuid(imageId);
  let storedName;
  await transaction(async (client) => {
    const image = (await client.query('SELECT * FROM product_catalog_images WHERE id=$1 FOR UPDATE', [imageId])).rows[0];
    if (!image) throw httpError(404, 'Imagem não encontrada.');
    await assertDraft(client, image.product_catalog_version_id);
    storedName = image.stored_name;
    await client.query('DELETE FROM product_catalog_images WHERE id=$1', [imageId]);
    await logAudit(client, { entityType: 'product_catalog_version', entityId: image.product_catalog_version_id, action: 'image_remove', previousValue: { image_id: imageId }, userId: user.id });
  });
  const references = await pool.query('SELECT COUNT(*)::int total FROM product_catalog_images WHERE stored_name=$1', [storedName]);
  if (!references.rows[0].total) await fs.unlink(resolveStored(storedName)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  return { id: imageId, deleted: true };
}

export async function getCatalogImage(imageId) {
  assertUuid(imageId);
  const image = (await pool.query('SELECT stored_name,mime_type,size_bytes FROM product_catalog_images WHERE id=$1', [imageId])).rows[0];
  if (!image) throw httpError(404, 'Imagem não encontrada.');
  return { buffer: await fs.readFile(resolveStored(image.stored_name)), mimeType: image.mime_type, sizeBytes: image.size_bytes };
}

export const productCatalogInternals = { normalizeBase, normalizeVersion };
