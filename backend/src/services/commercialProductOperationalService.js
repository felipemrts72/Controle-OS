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
         CASE WHEN $2::varchar IS NOT NULL AND lower(p.internal_code)=lower($2::varchar) THEN 'commercial_code' END,
         CASE WHEN ${NORMALIZED_NAME_SQL}=lower(regexp_replace(btrim($3::varchar), '[[:space:]]+', ' ', 'g')) THEN 'normalized_name' END
       ],NULL) AS match_reasons
     FROM products p
     WHERE p.id=$1::uuid
        OR ($2::varchar IS NOT NULL AND lower(p.internal_code)=lower($2::varchar))
        OR ${NORMALIZED_NAME_SQL}=lower(regexp_replace(btrim($3::varchar), '[[:space:]]+', ' ', 'g'))
     ORDER BY p.is_active DESC,p.created_at,p.id`,
    [commercialProduct.catalog_product_id, commercialProduct.commercial_code, commercialProduct.name],
  );
  return result.rows;
}

async function insertOperationalProduct(client, commercialProduct) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const code = String((await client.query("SELECT nextval('products_internal_code_seq') AS value")).rows[0].value);
    const result = await client.query(
      `INSERT INTO products(
         name,type,sector_id,default_volume_quantity,default_total_weight_kg,is_active,
         internal_code,measurement_unit_code,review_status,creation_origin,operational_cost
       ) VALUES($1,'manufactured',NULL,NULL,NULL,TRUE,$2,NULL,'pending_review','commercial',NULL)
       ON CONFLICT DO NOTHING RETURNING *`,
      [commercialProduct.name, code],
    );
    if (result.rows[0]) return result.rows[0];
  }
  throw new Error('Não foi possível reservar um código interno após 1000 tentativas.');
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

export async function ensureCommercialProductOperationalProduct(client, commercialProductId) {
  const decision = await inspectCommercialProductOperationalLink(client, commercialProductId, { lock: true });
  if (!decision) throw new Error('Produto Comercial não encontrado.');
  if (decision.action === 'preserve') {
    const product = (await client.query('SELECT * FROM products WHERE id=$1', [decision.productId])).rows[0];
    return { ...decision, product };
  }
  const product = decision.action === 'link_existing'
    ? (await client.query('SELECT * FROM products WHERE id=$1', [decision.productId])).rows[0]
    : await insertOperationalProduct(client, decision.commercialProduct);
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
