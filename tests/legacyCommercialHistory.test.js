import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pool } from '../backend/src/database/pool.js';
import {
  duplicateLegacyCommercialQuoteWithClient,
  getLegacyCommercialQuote,
  listCommercialQuoteOverview,
} from '../backend/src/services/legacyCommercialQuoteService.js';
import { getOrCreateLegacyReconstructedDocumentWithClient } from '../backend/src/services/legacyCommercialQuoteDocumentService.js';

after(async () => pool.end());

test('importação histórica real preserva sequência, snapshots, totais e identidade externa', async () => {
  const summary = (await pool.query(`SELECT COUNT(*)::int quotes,MIN(legacy_number)::int minimum,
    MAX(legacy_number)::int maximum,COUNT(DISTINCT legacy_number)::int distinct_numbers,
    SUM(item_count)::int items,SUM(items_gross_total)::numeric(20,2) gross,
    SUM(items_discount_total)::numeric(20,2) item_discount,SUM(general_discount_amount)::numeric(20,2) general_discount,
    SUM(total)::numeric(20,2) total,SUM(payment_total)::numeric(20,2) payments,
    COUNT(*) FILTER(WHERE locked_at IS NULL)::int unlocked FROM commercial_legacy_quotes`)).rows[0];
  assert.deepEqual(summary, { quotes:45, minimum:1, maximum:45, distinct_numbers:45, items:112,
    gross:'5498005.00', item_discount:'162200.00', general_discount:'10.00', total:'5335795.00',
    payments:'5035795.00', unlocked:0 });
  const aliases = (await pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE is_primary=FALSE)::int discarded
    FROM commercial_legacy_quote_source_aliases`)).rows[0];
  assert.deepEqual(aliases, { total:47, discarded:2 });
  const duplicate = (await pool.query(`SELECT array_agg(source_legacy_number ORDER BY source_legacy_number) numbers
    FROM commercial_legacy_quote_source_aliases WHERE commercial_legacy_quote_id=(
      SELECT commercial_legacy_quote_id FROM commercial_legacy_quote_source_aliases WHERE source_legacy_number=95)`)).rows[0];
  assert.deepEqual(duplicate.numbers.map(Number), [95,96,97]);
});

test('numeração legacy segue data original, criação e ID ERP como desempate', async () => {
  const result = await pool.query(`
    SELECT legacy_number,
           ROW_NUMBER() OVER (
             ORDER BY quote_date ASC NULLS LAST,
                      source_created_at ASC NULLS LAST,
                      source_id::bigint ASC
           )::bigint AS expected_number
    FROM commercial_legacy_quotes
    WHERE source_system = 'ERP_UNIVERSAL'
  `);
  assert.equal(result.rows.length, 45);
  assert.equal(result.rows.every((row) => row.legacy_number === row.expected_number), true);
});

test('Produtos Comerciais e Catálogos ERP ficam independentes de products operacional', async () => {
  const result = (await pool.query(`SELECT
    COUNT(*) FILTER(WHERE source_system='ERP_UNIVERSAL')::int products,
    COUNT(*) FILTER(WHERE source_system='ERP_UNIVERSAL' AND operational_product_id IS NULL)::int without_operational,
    COUNT(*) FILTER(WHERE source_system='ERP_UNIVERSAL' AND operational_product_id IS NOT NULL)::int with_operational
    FROM commercial_products`)).rows[0];
  assert.deepEqual(result, { products:65, without_operational:65, with_operational:0 });
  const catalog = (await pool.query(`SELECT
    (SELECT COUNT(DISTINCT c.id)::int FROM product_catalogs c JOIN product_catalog_versions v ON v.product_catalog_id=c.id
      WHERE c.source_system='ERP_UNIVERSAL' AND v.source_system='ERP_UNIVERSAL') technical_catalogs,
    (SELECT COUNT(*)::int FROM product_catalog_versions WHERE source_system='ERP_UNIVERSAL') versions,
    (SELECT COUNT(*)::int FROM product_catalog_images WHERE source_system='ERP_UNIVERSAL') images`)).rows[0];
  assert.equal(catalog.technical_catalogs, 14);
  assert.equal(catalog.versions, 19);
  assert.equal(catalog.images, 19);
  const children = (await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM product_catalog_specifications s JOIN product_catalog_versions v ON v.id=s.product_catalog_version_id WHERE v.source_system='ERP_UNIVERSAL') specifications,
    (SELECT COUNT(*)::int FROM product_catalog_included_items i JOIN product_catalog_versions v ON v.id=i.product_catalog_version_id WHERE v.source_system='ERP_UNIVERSAL') included_items,
    (SELECT COUNT(DISTINCT sha256)::int FROM product_catalog_images WHERE source_system='ERP_UNIVERSAL') unique_images`)).rows[0];
  assert.deepEqual(children, { specifications:38, included_items:62, unique_images:15 });
});

test('histórico sem pagamento permanece sem pagamento e todos os itens têm Produto Comercial opcional seguro', async () => {
  const sourceFour = (await pool.query(`SELECT commercial_legacy_quote_id FROM commercial_legacy_quote_source_aliases
    WHERE source_system='ERP_UNIVERSAL' AND source_legacy_number=4`)).rows[0];
  assert.ok(sourceFour);
  const payments = (await pool.query('SELECT COUNT(*)::int total FROM commercial_legacy_quote_payment_methods WHERE commercial_legacy_quote_id=$1',[sourceFour.commercial_legacy_quote_id])).rows[0];
  assert.equal(payments.total,0);
  const links = (await pool.query('SELECT COUNT(*)::int total FROM commercial_legacy_quote_items WHERE commercial_product_id IS NULL')).rows[0];
  assert.equal(links.total,0);
});

test('listagem separa atuais/antigos, conta linhas e busca o número ERP original', async () => {
  const legacy = await listCommercialQuoteOverview({origin:'legacy',limit:100});
  assert.equal(legacy.pagination.total,45);
  assert.ok(legacy.items.every((row)=>row.origin_type==='legacy' && Number(row.item_count)>0 && row.source_legacy_number));
  const current = await listCommercialQuoteOverview({origin:'current',limit:100});
  assert.ok(current.items.every((row)=>row.origin_type==='current'));
  const search = await listCommercialQuoteOverview({origin:'legacy',search:'ERP 83',limit:100});
  assert.equal(search.pagination.total,1);
  assert.equal(Number(search.items[0].source_legacy_number),83);
});

test('histórico bloqueado rejeita edição no banco', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = (await client.query('SELECT id FROM commercial_legacy_quotes ORDER BY legacy_number LIMIT 1')).rows[0].id;
    await assert.rejects(client.query('UPDATE commercial_legacy_quotes SET notes_snapshot=$1 WHERE id=$2',['alterado',id]),
      (error)=>error.code==='55000');
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
});

test('duplicação cria rascunho moderno em transação reversível e reutiliza Produto Comercial', async () => {
  const client = await pool.connect();
  const counterBefore = Number((await pool.query("SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key='global'")).rows[0].last_value);
  try {
    await client.query('BEGIN');
    const userId=(await client.query(`SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY id LIMIT 1`)).rows[0].id;
    const sourceId=(await client.query('SELECT id FROM commercial_legacy_quotes ORDER BY legacy_number LIMIT 1')).rows[0].id;
    const source=await getLegacyCommercialQuote(sourceId,client);
    const duplicate=await duplicateLegacyCommercialQuoteWithClient(sourceId,{id:userId},client);
    assert.equal(duplicate.status,'draft');
    assert.equal(Number(duplicate.commercial_number),counterBefore+1);
    assert.equal(duplicate.items.length,source.items.length);
    assert.ok(duplicate.items.every((item)=>item.commercial_product_id && item.product_id===null && item.save_product_requested===false));
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
  const counterAfter=Number((await pool.query("SELECT last_value FROM commercial_quote_commercial_counters WHERE counter_key='global'")).rows[0].last_value);
  assert.equal(counterAfter,counterBefore);
});

test('PDF histórico reconstruído usa snapshot, pagamento e somente versão exata de Catálogo', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = (await client.query(`SELECT id FROM users WHERE username='felipe'`)).rows[0].id;
    const withCatalog = (await client.query(`SELECT q.id FROM commercial_legacy_quotes q
      WHERE EXISTS(SELECT 1 FROM commercial_legacy_quote_items i WHERE i.commercial_legacy_quote_id=q.id AND i.source_catalog_version_id IS NOT NULL)
      ORDER BY q.legacy_number LIMIT 1`)).rows[0].id;
    const withoutCatalog = (await client.query(`SELECT q.id FROM commercial_legacy_quotes q
      WHERE NOT EXISTS(SELECT 1 FROM commercial_legacy_quote_items i WHERE i.commercial_legacy_quote_id=q.id AND i.source_catalog_version_id IS NOT NULL)
      ORDER BY q.legacy_number LIMIT 1`)).rows[0].id;

    const first = await getOrCreateLegacyReconstructedDocumentWithClient(withCatalog,userId,client);
    const same = await getOrCreateLegacyReconstructedDocumentWithClient(withCatalog,userId,client);
    const plain = await getOrCreateLegacyReconstructedDocumentWithClient(withoutCatalog,userId,client);
    assert.equal(first.classification,'RECONSTRUCTED');
    assert.equal(first.pdf.subarray(0,5).toString(),'%PDF-');
    assert.deepEqual(first.pdf,same.pdf);
    assert.equal(plain.pdf.subarray(0,5).toString(),'%PDF-');

    const rows = (await client.query(`SELECT provenance_classification,document_kind,document_data_snapshot,
      renderer_version,pdf_data,sha256 FROM commercial_legacy_quote_documents
      WHERE commercial_legacy_quote_id=ANY($1::uuid[]) ORDER BY commercial_legacy_quote_id`,[[withCatalog,withoutCatalog]])).rows;
    assert.equal(rows.length,2);
    assert.ok(rows.every((row)=>row.provenance_classification==='RECONSTRUCTED' && row.document_kind==='reconstructed' && row.pdf_data.length>1000));
    const catalogCounts=rows.map((row)=>row.document_data_snapshot.catalogs.length).sort((a,b)=>a-b);
    assert.equal(catalogCounts[0],0);
    assert.ok(catalogCounts[1]>0);
    assert.ok(rows.every((row)=>row.document_data_snapshot.customer.name && Array.isArray(row.document_data_snapshot.payment_methods)));
    assert.doesNotMatch(JSON.stringify(rows.map((row)=>row.document_data_snapshot)),/internal_notes|sop|operational_cost/i);
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
});

test('UI mostra abas, contagem de itens e número ERP original nos cards', () => {
  const page=fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/QuotesPage.jsx',import.meta.url),'utf8');
  const detail=fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/QuoteDetailPage.jsx',import.meta.url),'utf8');
  assert.match(page,/\['all', 'Todos'\], \['current', 'Atuais'\], \['legacy', 'Antigos'\]/);
  assert.match(page,/ERP original #\{row\.source_legacy_number\}/);
  assert.match(page,/row\.item_count/);
  assert.match(detail,/Número original no ERP/);
  assert.match(detail,/Duplicar para novo orçamento/);
  assert.match(detail,/Visualizar PDF histórico reconstruído/);
  assert.match(detail,/Baixar PDF/);
  assert.match(detail,/printAuthenticatedPdf\(path\)/);
  assert.match(detail,/\/commercial\/quotes\/legacy\/\$\{id\}\/pdf/);
});
