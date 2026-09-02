import { pool } from '../backend/src/database/pool.js';
import {
  auditCommercialProductOperationalLinks,
  regularizeCommercialProductOperationalLinks,
} from '../backend/src/services/commercialProductOperationalService.js';

const apply = process.argv.includes('--apply');

function printAudit(audit) {
  console.log(`Produtos Comerciais: ${audit.commercial_products}`);
  console.log(`Com Catálogo Técnico: ${audit.with_catalog}`);
  console.log(`Já vinculados ao Estoque: ${audit.linked}`);
  console.log(`Sem vínculo: ${audit.unlinked}`);
  console.log(`Correspondências internas seguras encontradas: ${audit.safeMatches}`);
  console.log(`Produtos internos que precisarão ser criados: ${audit.toCreate}`);
  console.log(`Ambiguidades: ${audit.ambiguities.length}`);
  for (const item of audit.ambiguities) {
    console.log(`  - ${item.commercialProduct.name}: ${item.candidates.map((candidate) => `${candidate.name} [${candidate.id}]`).join('; ')}`);
  }
}

const client = await pool.connect();
try {
  if (!apply) {
    console.log('DRY-RUN — nenhuma alteração será feita.');
    printAudit(await auditCommercialProductOperationalLinks(client));
  } else {
    await client.query('BEGIN');
    const before = await auditCommercialProductOperationalLinks(client);
    console.log('ANTES');
    printAudit(before);
    const results = await regularizeCommercialProductOperationalLinks(client);
    const after = await auditCommercialProductOperationalLinks(client);
    if (after.unlinked !== 0) throw new Error(`Regularização incompleta: ${after.unlinked} Produto(s) Comercial(is) ainda sem vínculo.`);
    await client.query('COMMIT');
    console.log('APLICADO');
    console.log(`Vínculos preservados: ${results.filter((item) => item.action === 'preserve').length}`);
    console.log(`Vinculados a Produto existente: ${results.filter((item) => item.action === 'link_existing').length}`);
    const created = results.filter((item) => item.action === 'create');
    console.log(`Produtos internos criados: ${created.length}`);
    for (const item of created) console.log(`  - código ${item.product.internal_code}: ${item.product.name}`);
    console.log('DEPOIS');
    printAudit(after);
  }
} catch (error) {
  if (apply) await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
