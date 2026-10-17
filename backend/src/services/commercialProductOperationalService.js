import { httpError } from '../utils/httpError.js';
const NORMALIZED_NAME_SQL = "lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))";

async function loadCommercialProduct(client, commercialProductId, lock = false) {
  return (await client.query(
    `SELECT cp.*,c.id AS catalog_id,c.product_id AS catalog_product_id
     FROM commercial_products cp
     LEFT JOIN product_catalogs c ON c.commercial_product_id=cp.id
     WHERE cp.id=$1${lock ? ' FOR UPDATE OF cp' : ''}`,
    [commercialProductId],
  )).rows[0];
}

async function exactCandidates(client, commercialProduct) {
  const result = await client.query(
    `SELECT p.id,p.name,p.internal_code,p.type,p.is_active,
       ARRAY_REMOVE(ARRAY[
         CASE WHEN p.id=$1::uuid THEN 'catalog_product_id' END,
         CASE WHEN ${NORMALIZED_NAME_SQL}=lower(regexp_replace(btrim($2::varchar), '[[:space:]]+', ' ', 'g')) THEN 'normalized_name' END
       ],NULL) AS match_reasons
     FROM products p
     WHERE p.id=$1::uuid
        OR ${NORMALIZED_NAME_SQL}=lower(regexp_replace(btrim($2::varchar), '[[:space:]]+', ' ', 'g'))
     ORDER BY p.is_active DESC,p.created_at,p.id`,
    [commercialProduct.catalog_product_id, commercialProduct.name],
  );
  return result.rows;
}

async function insertOperationalProduct(client, commercialProduct, sectorId = null) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const code = String((await client.query("SELECT nextval('products_internal_code_seq') AS value")).rows[0].value);
    const result = await client.query(
      `INSERT INTO products(
         name,type,sector_id,default_volume_quantity,default_total_weight_kg,is_active,
         internal_code,measurement_unit_code,review_status,creation_origin,operational_cost
       ) VALUES($1,'manufactured',$3,NULL,NULL,TRUE,$2,NULL,'pending_review','commercial',NULL)
       ON CONFLICT DO NOTHING RETURNING *`,
      [commercialProduct.name, code, sectorId],
    );
    if (result.rows[0]) return result.rows[0];
  }
  throw new Error('Não foi possível reservar um código interno após 1000 tentativas.');
}

export async function createQuickOperationalProduct(client, { name, sector_id: sectorId, commercial_product_id: commercialProductId }, user) {
  name = String(name || '').trim();
  if (!name || name.length > 220) throw httpError(400, 'Informe um nome com até 220 caracteres.');
  if (!sectorId || !(await client.query('SELECT id FROM sectors WHERE id=$1 AND is_active=TRUE', [sectorId])).rowCount) throw httpError(400, 'Selecione um setor ativo.');
  if (commercialProductId) {
    const current = await loadCommercialProduct(client, commercialProductId, true);
    if (!current) throw httpError(404, 'Produto Comercial não encontrado.');
    if (current.operational_product_id || current.catalog_product_id) {
      return (await ensureCommercialProductOperationalProduct(client, commercialProductId)).product;
    }
  }
  const product = await insertOperationalProduct(client, { name }, sectorId);
  if (commercialProductId) await client.query('UPDATE commercial_products SET operational_product_id=$1,updated_by=$2,updated_at=NOW() WHERE id=$3', [product.id, user.id, commercialProductId]);
  return product;
}

export async function inspectCommercialProductOperationalLink(client, commercialProductId, { lock = false } = {}) {
  const commercialProduct = await loadCommercialProduct(client, commercialProductId, lock);
  if (!commercialProduct) return null;
  if (commercialProduct.operational_product_id) {
    return { action: 'preserve', commercialProduct, productId: commercialProduct.operational_product_id, candidates: [] };
  }
  if (commercialProduct.catalog_product_id) {
    const product = (await client.query('SELECT id,name,internal_code,type,is_active FROM products WHERE id=$1', [commercialProduct.catalog_product_id])).rows[0];
    if (product) return { action: 'link_existing', commercialProduct, productId: product.id, candidates: [{ ...product, match_reasons: ['catalog_product_id'] }] };
  }
  const candidates = await exactCandidates(client, commercialProduct);
  if (candidates.length === 1) {
    return { action: 'link_existing', commercialProduct, productId: candidates[0].id, candidates };
  }
  return { action: 'create', commercialProduct, productId: null, candidates, ambiguous: candidates.length > 1 };
}

export async function ensureCommercialProductOperationalProduct(client, commercialProductId, options = {}) {
  const decision = await inspectCommercialProductOperationalLink(client, commercialProductId, { lock: true });
  if (!decision) throw new Error('Produto Comercial não encontrado.');
  // Catalog creation requires an explicit choice for name matches; historical
  // regularization keeps its existing matching policy.
  if (options.catalogCreation && !decision.commercialProduct.operational_product_id && !decision.commercialProduct.catalog_product_id) {
    if (options.operationalProductId) {
      const selected = (await client.query('SELECT * FROM products WHERE id=$1 AND is_active=TRUE', [options.operationalProductId])).rows[0];
      if (!selected) throw httpError(400, 'Selecione um Produto do Estoque ativo.');
      decision.action = 'link_existing';
      decision.productId = selected.id;
    } else {
      if (decision.candidates.length && options.allowDuplicate !== true) throw httpError(409, 'Já existe um produto no Estoque com este nome. Selecione o existente ou confirme a criação de um novo.', {
        code: 'OPERATIONAL_PRODUCT_NAME_EXISTS', details: { candidates: decision.candidates },
      });
      if (!options.sectorId || !(await client.query('SELECT id FROM sectors WHERE id=$1 AND is_active=TRUE', [options.sectorId])).rowCount) {
        throw httpError(400, 'Selecione um setor ativo responsável pela fabricação.', { field: 'manufacturing_sector_id' });
      }
      decision.action = 'create';
    }
  }
  if (decision.action === 'preserve') {
    const product = (await client.query('SELECT * FROM products WHERE id=$1', [decision.productId])).rows[0];
    return { ...decision, product };
  }
  const product = decision.action === 'link_existing'
    ? (await client.query('SELECT * FROM products WHERE id=$1', [decision.productId])).rows[0]
    : await insertOperationalProduct(client, decision.commercialProduct, options.sectorId || null);
  await client.query(
    `UPDATE commercial_products
     SET operational_product_id=$1,updated_at=NOW()
     WHERE id=$2 AND operational_product_id IS NULL`,
    [product.id, commercialProductId],
  );
  return { ...decision, productId: product.id, product };
}

export async function auditCommercialProductOperationalLinks(client) {
  const totals = (await client.query(
    `SELECT COUNT(*)::int AS commercial_products,
       COUNT(*) FILTER(WHERE c.id IS NOT NULL)::int AS with_catalog,
       COUNT(*) FILTER(WHERE c.id IS NOT NULL AND cp.operational_product_id IS NOT NULL)::int AS linked,
       COUNT(*) FILTER(WHERE c.id IS NOT NULL AND cp.operational_product_id IS NULL)::int AS unlinked
     FROM commercial_products cp
     LEFT JOIN product_catalogs c ON c.commercial_product_id=cp.id`,
  )).rows[0];
  const rows = (await client.query(
    `SELECT cp.id FROM commercial_products cp
     JOIN product_catalogs c ON c.commercial_product_id=cp.id
     ORDER BY cp.name,cp.id`,
  )).rows;
  const decisions = [];
  for (const row of rows) decisions.push(await inspectCommercialProductOperationalLink(client, row.id));
  return {
    ...totals,
    safeMatches: decisions.filter((item) => item.action === 'link_existing').length,
    toCreate: decisions.filter((item) => item.action === 'create').length,
    ambiguities: decisions.filter((item) => item.ambiguous),
    decisions,
  };
}

export async function regularizeCommercialProductOperationalLinks(client, commercialProductIds = null) {
  const rows = (await client.query(
    `SELECT cp.id FROM commercial_products cp
     JOIN product_catalogs c ON c.commercial_product_id=cp.id
     WHERE $1::uuid[] IS NULL OR cp.id=ANY($1::uuid[])
     ORDER BY cp.name,cp.id`,
    [commercialProductIds],
  )).rows;
  const results = [];
  for (const row of rows) results.push(await ensureCommercialProductOperationalProduct(client, row.id));
  return results;
}
