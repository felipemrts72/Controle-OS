import fs from 'node:fs/promises';
import { pool, transaction } from '../backend/src/database/pool.js';
import { getCatalogVersionUsage } from '../backend/src/services/catalogVersionUsageService.js';
import { getCatalogByCommercialProduct, productCatalogInternals } from '../backend/src/services/productCatalogService.js';
import { logAudit } from '../backend/src/services/auditService.js';

// Deliberately scoped to the audited ERP product, never selected by title alone.
const productId = '20335110-3ea7-4272-86e7-64d62ff6bce3';
const catalogId = '88f1580e-b6d1-4ded-b019-c5e20e2b2a8a';
const keepId = '3c7184f0-d1ec-4526-a1c1-f3e88d9acb46';
const removeIds = ['f6ad4790-826e-4aea-b6c0-94a4df8f6840', '60f45e12-76ed-40cb-aa78-beb522c76c78'];
const content = {
  commercial_title: 'Britador de Mandíbula 30×20',
  subtitle: 'Britador compacto para redução primária de pedras e minérios.',
  presentation_text: 'O Britador de Mandíbula 30×20 é indicado para a quebra e redução do material antes da etapa de moagem, preparando a granulometria para alimentação do moinho.',
  specifications: [{ name: 'Boca de britagem', value: '30 × 20 cm' }, { name: 'Motor', value: '13 CV' }],
  included_items: [{ description: 'Base completa com adaptações necessárias' }],
  applications_text: 'Britagem de pedras, minérios e materiais de mineração, especialmente como etapa de preparação antes do moinho.',
  additional_text: 'Estrutura reforçada\nEquipamento completo com motor', notes: null,
};

try {
  await fs.mkdir('output/pdf', { recursive: true });
  const before = await getCatalogByCommercialProduct(productId, { permissions: [] });
  if (before.id !== catalogId || before.source_system !== 'ERP_UNIVERSAL' || before.source_id !== '9'
    || before.operational_product_id !== 'cba2888a-b60e-42c5-901b-f6d677101c1c' || before.commercial_code !== '51') throw new Error('Identidade do produto divergiu da auditoria.');
  console.log(JSON.stringify({ productId, catalogId, versions: before.versions.map(({ id, version_number, is_used, has_quote_references }) => ({ id, version_number, is_used, has_quote_references })) }, null, 2));
  if (process.argv.includes('--apply')) {
    const result = await transaction(async (client) => {
      await client.query('SELECT id FROM product_catalogs WHERE id=$1 FOR UPDATE', [catalogId]);
      const versions = (await client.query('SELECT * FROM product_catalog_versions WHERE product_catalog_id=$1 ORDER BY id FOR UPDATE', [catalogId])).rows;
      if (versions.some((v) => ![keepId, ...removeIds].includes(v.id))) throw new Error('Versões novas detectadas: audite novamente antes de regularizar.');
      if (!versions.some((v) => v.id === keepId)) throw new Error('Versão a preservar não encontrada.');
      const usage = await getCatalogVersionUsage(client, versions.map((v) => v.id));
      if (versions.some((v) => usage.get(v.id).is_used)) throw new Error('Uso histórico detectado. Nada alterado; requer nova versão e auditoria.');
      if (removeIds.some((id) => usage.get(id)?.has_quote_references)) throw new Error('Versão a excluir possui referência estrutural. Nada alterado.');
      // Preserve the full pre-change evidence before the first database mutation.
      await fs.writeFile('output/pdf/britador-auditoria-antes.json', JSON.stringify(before, null, 2), { flag: 'wx' });
      const userId = versions.find((v) => v.id === keepId).updated_by;
      for (const id of removeIds.filter((id) => versions.some((v) => v.id === id))) {
        for (const table of ['product_catalog_images', 'product_catalog_specifications', 'product_catalog_included_items']) await client.query(`DELETE FROM ${table} WHERE product_catalog_version_id=$1`, [id]);
        await client.query('DELETE FROM product_catalog_versions WHERE id=$1 AND product_catalog_id=$2', [id, catalogId]);
        await logAudit(client, { entityType: 'product_catalog_version', entityId: id, action: 'delete_unused', previousValue: before.versions.find((v) => v.id === id), userId });
      }
      const normalized = productCatalogInternals.normalizeVersion(content);
      await client.query(`UPDATE product_catalog_versions SET commercial_title=$1,subtitle=$2,presentation_text=$3,applications_text=$4,additional_text=$5,notes=NULL,updated_at=NOW() WHERE id=$6`, [normalized.commercial_title, normalized.subtitle, normalized.presentation_text, normalized.applications_text, normalized.additional_text, keepId]);
      for (const table of ['product_catalog_images', 'product_catalog_specifications', 'product_catalog_included_items']) await client.query(`DELETE FROM ${table} WHERE product_catalog_version_id=$1`, [keepId]);
      for (const item of normalized.specifications) await client.query('INSERT INTO product_catalog_specifications(product_catalog_version_id,name,value,position) VALUES($1,$2,$3,$4)', [keepId, item.name, item.value, item.position]);
      for (const item of normalized.includedItems) await client.query('INSERT INTO product_catalog_included_items(product_catalog_version_id,description,position) VALUES($1,$2,$3)', [keepId, item.description, item.position]);
      await logAudit(client, { entityType: 'product_catalog_version', entityId: keepId, action: 'regularize_unused', previousValue: before.versions.find((v) => v.id === keepId), newValue: { ...content, images: [] }, userId });
      return getCatalogByCommercialProduct(productId, { permissions: [] }, client);
    });
    await fs.writeFile('output/pdf/britador-auditoria-depois.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ before: before.versions.length, removed: before.versions.length - result.versions.length, after: result.versions.length, final_version: result.versions[0].version_number, images: result.versions[0].images.length }));
  }
} finally { await pool.end(); }
