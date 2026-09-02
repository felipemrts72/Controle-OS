import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

const [erpEnvPath, erpBackendRoot] = process.argv.slice(2);
if (!erpEnvPath || !erpBackendRoot) {
  throw new Error('Uso: node scripts/preflight-erp-commercial-history.js <erp-env> <erp-backend-root>');
}

const env = dotenv.parse(await fs.readFile(path.resolve(erpEnvPath), 'utf8'));
const client = new pg.Client({ connectionString: env.DATABASE_URL });

async function inspectImage(row) {
  const relative = String(row.caminho_imagem || '').replace(/^[/\\]+/, '').replaceAll('/', path.sep);
  const absolute = path.resolve(erpBackendRoot, relative);
  const allowedRoot = path.resolve(erpBackendRoot, 'uploads') + path.sep;
  if (!absolute.startsWith(allowedRoot)) return { ...row, status: 'outside_uploads', absolute: null };
  try {
    const bytes = await fs.readFile(absolute);
    return {
      ...row,
      status: 'ok',
      bytes: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      extension: path.extname(absolute).toLowerCase(),
    };
  } catch (error) {
    return { ...row, status: error.code === 'ENOENT' ? 'missing' : `error:${error.code}`, absolute: null };
  }
}

try {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  const usedProducts = await client.query(`
    SELECT p.id,p.nome,p.descricao,p.sku,p.preco_venda,p.unidade_medida,p.status,
      COUNT(i.id)::int item_lines,COUNT(DISTINCT i.orcamento_id)::int quote_count,
      array_agg(DISTINCT i.catalogo_versao_id ORDER BY i.catalogo_versao_id)
        FILTER (WHERE i.catalogo_versao_id IS NOT NULL) catalog_version_ids
    FROM itens_orcamento i JOIN produtos p ON p.id=i.produto_id
    GROUP BY p.id ORDER BY p.id`);
  const manualProducts = await client.query(`
    SELECT lower(regexp_replace(btrim(COALESCE(NULLIF(nome_customizado,''),NULLIF(descricao,''),'Item ERP sem nome')), '[[:space:]]+', ' ', 'g')) normalized_name,
      MIN(COALESCE(NULLIF(btrim(nome_customizado),''),NULLIF(btrim(descricao),''),'Item ERP sem nome')) representative_name,
      COUNT(*)::int item_lines,array_agg(id ORDER BY id) source_item_ids
    FROM itens_orcamento WHERE produto_id IS NULL GROUP BY 1 ORDER BY 1`);
  const catalogs = await client.query(`
    SELECT cp.id,cp.produto_id,cp.possui_catalogo,cp.categoria_catalogo,
      COUNT(cv.id)::int versions,
      COUNT(cv.id) FILTER (WHERE cv.ativo)::int active_versions,
      COUNT(DISTINCT io.orcamento_id)::int referenced_quotes
    FROM catalogo_produto cp
    LEFT JOIN catalogo_versoes cv ON cv.catalogo_id=cp.id
    LEFT JOIN itens_orcamento io ON io.catalogo_versao_id=cv.id
    WHERE cp.produto_id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL)
    GROUP BY cp.id ORDER BY cp.produto_id`);
  const versions = await client.query(`
    SELECT cv.*,cp.produto_id,
      COUNT(DISTINCT io.orcamento_id)::int referenced_quotes,
      (SELECT COUNT(*) FROM catalogo_imagens ci WHERE ci.versao_id=cv.id)::int images,
      (SELECT COUNT(*) FROM catalogo_especificacoes ce WHERE ce.versao_id=cv.id)::int specifications,
      (SELECT COUNT(*) FROM catalogo_itens_inclusos cii WHERE cii.versao_id=cv.id)::int included_items
    FROM catalogo_versoes cv JOIN catalogo_produto cp ON cp.id=cv.catalogo_id
    LEFT JOIN itens_orcamento io ON io.catalogo_versao_id=cv.id
    WHERE cp.produto_id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL)
    GROUP BY cv.id,cp.produto_id ORDER BY cp.produto_id,cv.versao`);
  const images = await client.query(`
    SELECT ci.id,ci.versao_id,cp.produto_id,ci.caminho_imagem,ci.legenda,ci.ordem,ci.imagem_principal
    FROM catalogo_imagens ci JOIN catalogo_versoes cv ON cv.id=ci.versao_id
    JOIN catalogo_produto cp ON cp.id=cv.catalogo_id
    WHERE cp.produto_id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL)
    ORDER BY cp.produto_id,cv.versao,ci.ordem,ci.id`);
  const specifications = await client.query(`
    SELECT COUNT(*)::int total FROM catalogo_especificacoes ce JOIN catalogo_versoes cv ON cv.id=ce.versao_id
    JOIN catalogo_produto cp ON cp.id=cv.catalogo_id
    WHERE cp.produto_id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL)`);
  const included = await client.query(`
    SELECT COUNT(*)::int total FROM catalogo_itens_inclusos cii JOIN catalogo_versoes cv ON cv.id=cii.versao_id
    JOIN catalogo_produto cp ON cp.id=cv.catalogo_id
    WHERE cp.produto_id IN (SELECT DISTINCT produto_id FROM itens_orcamento WHERE produto_id IS NOT NULL)`);
  const inspectedImages = await Promise.all(images.rows.map(inspectImage));
  const uniqueHashes = new Set(inspectedImages.filter((item) => item.sha256).map((item) => item.sha256));
  console.log(JSON.stringify({
    used_source_products: usedProducts.rows.length,
    manual_product_groups: manualProducts.rows.length,
    proposed_commercial_products: usedProducts.rows.length + manualProducts.rows.length,
    used_products: usedProducts.rows,
    manual_products: manualProducts.rows,
    catalogs: catalogs.rows,
    catalog_versions: versions.rows,
    catalog_totals: {
      products_with_catalog_row: catalogs.rows.length,
      products_marked_with_catalog: catalogs.rows.filter((row) => row.possui_catalogo).length,
      versions: versions.rows.length,
      active_versions: versions.rows.filter((row) => row.ativo).length,
      referenced_versions: versions.rows.filter((row) => row.referenced_quotes > 0).length,
      images: inspectedImages.length,
      images_ok: inspectedImages.filter((row) => row.status === 'ok').length,
      images_missing: inspectedImages.filter((row) => row.status === 'missing').length,
      images_outside_uploads: inspectedImages.filter((row) => row.status === 'outside_uploads').length,
      unique_image_contents: uniqueHashes.size,
      duplicate_image_records: inspectedImages.filter((row) => row.sha256).length - uniqueHashes.size,
      specifications: specifications.rows[0].total,
      included_items: included.rows[0].total,
    },
    images: inspectedImages,
  }, null, 2));
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
