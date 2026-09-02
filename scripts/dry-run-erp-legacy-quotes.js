import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

const [erpEnvPath, olimenEnvPath, erpRootPath] = process.argv.slice(2);
if (!erpEnvPath || !olimenEnvPath || !erpRootPath) {
  console.error('Uso: node scripts/dry-run-erp-legacy-quotes.js <erp-backend-env> <olimen-env> <erp-root>');
  process.exit(2);
}

const erpEnv = dotenv.parse(await fs.readFile(path.resolve(erpEnvPath), 'utf8'));
const olimenEnv = dotenv.parse(await fs.readFile(path.resolve(olimenEnvPath), 'utf8'));
if (!erpEnv.DATABASE_URL || !olimenEnv.DATABASE_URL) throw new Error('DATABASE_URL ausente em um dos arquivos informados.');

const erp = new pg.Client({ connectionString: erpEnv.DATABASE_URL });
const olimen = new pg.Client({ connectionString: olimenEnv.DATABASE_URL });

async function listFiles(directory) {
  const result = [];
  async function visit(current) {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(directory);
  return result;
}

try {
  await Promise.all([erp.connect(), olimen.connect()]);
  await Promise.all([
    erp.query('BEGIN TRANSACTION READ ONLY'),
    olimen.query('BEGIN TRANSACTION READ ONLY'),
  ]);

  const requiredTables = ['orcamentos', 'itens_orcamento', 'clientes', 'orcamento_formas_pagamento', 'orcamento_pagamento_parcelas'];
  const tableResult = await erp.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name`, [requiredTables],
  );
  const actualTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !actualTables.has(name));
  if (missingTables.length) throw new Error(`Tabelas obrigatórias ausentes: ${missingTables.join(', ')}`);

  const summary = await erp.query(`
      WITH item_totals AS (
        SELECT o.id,
          COUNT(i.id)::int item_count,
          COALESCE(SUM(i.quantidade * i.preco_unitario),0)::numeric(18,2) gross,
          COALESCE(SUM(CASE WHEN i.desconto_valor > 0
            THEN i.desconto_valor * i.quantidade
            ELSE i.quantidade * i.preco_unitario * i.desconto_percentual / 100 END),0)::numeric(18,2) item_discount
        FROM orcamentos o LEFT JOIN itens_orcamento i ON i.orcamento_id=o.id GROUP BY o.id
      ), payment_totals AS (
        SELECT o.id,COUNT(fp.id)::int payment_method_count,COALESCE(SUM(fp.valor),0)::numeric(18,2) payment_total
        FROM orcamentos o LEFT JOIN orcamento_formas_pagamento fp ON fp.orcamento_id=o.id GROUP BY o.id
      )
      SELECT COUNT(*)::int total_quotes,MIN(o.id)::int minimum_number,MAX(o.id)::int maximum_number,
        MIN(o.data_orcamento) minimum_date,MAX(o.data_orcamento) maximum_date,
        COUNT(*) FILTER(WHERE o.id>=250)::int numbers_at_or_above_250,
        COUNT(*) FILTER(WHERE o.cliente_id IS NULL)::int without_customer_link,
        COUNT(*) FILTER(WHERE btrim(COALESCE(o.cliente_nome,''))='')::int without_customer_name,
        COUNT(*) FILTER(WHERE it.item_count=0)::int without_items,
        COALESCE(SUM(it.item_count),0)::int total_items,
        COUNT(*) FILTER(WHERE pt.payment_method_count=0)::int without_payment_methods,
        COUNT(*) FILTER(WHERE pt.payment_method_count>0)::int with_payment_methods,
        COALESCE(SUM(pt.payment_method_count),0)::int total_payment_methods,
        COALESCE(SUM(it.gross),0)::numeric(20,2) aggregate_gross,
        COALESCE(SUM(it.item_discount),0)::numeric(20,2) aggregate_item_discount,
        COALESCE(SUM(o.desconto_geral),0)::numeric(20,2) aggregate_general_discount,
        COALESCE(SUM(GREATEST(it.gross-it.item_discount-o.desconto_geral,0)),0)::numeric(20,2) aggregate_calculated_final
      FROM orcamentos o JOIN item_totals it ON it.id=o.id JOIN payment_totals pt ON pt.id=o.id`);
  const duplicateNumbers = await erp.query('SELECT id,COUNT(*)::int occurrences FROM orcamentos GROUP BY id HAVING COUNT(*)>1 ORDER BY id');
  const gaps = await erp.query(`SELECT candidate AS missing_number FROM generate_series(
      (SELECT MIN(id) FROM orcamentos),(SELECT MAX(id) FROM orcamentos)) candidate
      LEFT JOIN orcamentos o ON o.id=candidate WHERE o.id IS NULL ORDER BY candidate`);
  const statuses = await erp.query('SELECT status,COUNT(*)::int total FROM orcamentos GROUP BY status ORDER BY status');
  const payments = await erp.query(`SELECT
      COUNT(*) FILTER(WHERE p.payment_count>0 AND ABS(p.payment_total-c.calculated_total)>0.009)::int payment_total_mismatches,
      COUNT(*) FILTER(WHERE p.payment_count>0 AND ABS(p.payment_total-c.calculated_total)<=0.009)::int payment_totals_matching,
      COUNT(*) FILTER(WHERE p.payment_count=0)::int no_payment_to_compare,
      COALESCE(SUM(pp.total),0)::int total_installments
     FROM (
       SELECT o.id,GREATEST(COALESCE(SUM(CASE WHEN i.desconto_valor>0
         THEN i.quantidade*i.preco_unitario-i.desconto_valor*i.quantidade
         ELSE i.quantidade*i.preco_unitario*(1-i.desconto_percentual/100) END),0)-o.desconto_geral,0) calculated_total
       FROM orcamentos o LEFT JOIN itens_orcamento i ON i.orcamento_id=o.id GROUP BY o.id
     ) c
     JOIN (SELECT o.id,COUNT(fp.id) payment_count,COALESCE(SUM(fp.valor),0) payment_total
       FROM orcamentos o LEFT JOIN orcamento_formas_pagamento fp ON fp.orcamento_id=o.id GROUP BY o.id) p ON p.id=c.id
     LEFT JOIN (SELECT fp.orcamento_id,COUNT(par.id)::int total FROM orcamento_formas_pagamento fp
       LEFT JOIN orcamento_pagamento_parcelas par ON par.forma_pagamento_id=fp.id GROUP BY fp.orcamento_id) pp ON pp.orcamento_id=c.id`);
  const paymentMethods = await erp.query('SELECT forma,COUNT(*)::int records,COUNT(DISTINCT orcamento_id)::int quotes,COALESCE(SUM(valor),0)::numeric(20,2) total FROM orcamento_formas_pagamento GROUP BY forma ORDER BY forma');
  const issues = await erp.query(`SELECT
      COUNT(*) FILTER(WHERE i.desconto_valor>0 AND i.desconto_percentual>0)::int items_with_both_discount_types,
      COUNT(*) FILTER(WHERE i.produto_id IS NULL)::int items_without_product,
      COUNT(*) FILTER(WHERE i.incluir_catalogo=TRUE)::int items_with_catalog,
      COUNT(*) FILTER(WHERE i.incluir_catalogo=TRUE AND i.catalogo_versao_id IS NULL)::int invalid_catalog_links,
      COUNT(*) FILTER(WHERE i.quantidade>=100)::int items_quantity_at_least_100
     FROM itens_orcamento i`);
  const samples = await erp.query(`SELECT o.id,o.cliente_nome,o.data_orcamento,o.status,COUNT(i.id)::int item_count,
      COALESCE(SUM(i.quantidade*i.preco_unitario),0)::numeric(18,2) gross,
      COALESCE(SUM(CASE WHEN i.desconto_valor>0 THEN i.desconto_valor*i.quantidade
        ELSE i.quantidade*i.preco_unitario*i.desconto_percentual/100 END),0)::numeric(18,2) item_discount,
      o.desconto_geral,
      GREATEST(COALESCE(SUM(CASE WHEN i.desconto_valor>0
        THEN i.quantidade*i.preco_unitario-i.desconto_valor*i.quantidade
        ELSE i.quantidade*i.preco_unitario*(1-i.desconto_percentual/100) END),0)-o.desconto_geral,0)::numeric(18,2) calculated_final
     FROM orcamentos o LEFT JOIN itens_orcamento i ON i.orcamento_id=o.id
     GROUP BY o.id ORDER BY o.id LIMIT 10`);
  const semanticDuplicates = await erp.query(`
    WITH item_payload AS (
      SELECT o.id,COALESCE(jsonb_agg(jsonb_build_array(
        i.produto_id,i.quantidade,i.preco_unitario,i.desconto_valor,i.desconto_percentual,
        i.nome_customizado,i.descricao,i.incluir_catalogo,i.catalogo_versao_id
      ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) payload
      FROM orcamentos o LEFT JOIN itens_orcamento i ON i.orcamento_id=o.id GROUP BY o.id
    ), payment_payload AS (
      SELECT o.id,COALESCE(jsonb_agg(jsonb_build_array(
        fp.forma,fp.valor,fp.parcelas,fp.ordem
      ) ORDER BY fp.ordem,fp.id) FILTER (WHERE fp.id IS NOT NULL),'[]'::jsonb) payload
      FROM orcamentos o LEFT JOIN orcamento_formas_pagamento fp ON fp.orcamento_id=o.id GROUP BY o.id
    ), fingerprints AS (
      SELECT o.id,md5(concat_ws('|',lower(btrim(o.cliente_nome)),o.data_orcamento::text,
        o.desconto_geral::text,o.status,COALESCE(o.observacoes,''),ip.payload::text,pp.payload::text)) fingerprint
      FROM orcamentos o JOIN item_payload ip ON ip.id=o.id JOIN payment_payload pp ON pp.id=o.id
    )
    SELECT array_agg(id ORDER BY id) quote_numbers,COUNT(*)::int occurrences
    FROM fingerprints GROUP BY fingerprint HAVING COUNT(*)>1 ORDER BY MIN(id)`);
  const noPaymentQuotes = await erp.query(`
    SELECT o.id FROM orcamentos o
    LEFT JOIN orcamento_formas_pagamento fp ON fp.orcamento_id=o.id
    GROUP BY o.id HAVING COUNT(fp.id)=0 ORDER BY o.id`);
  const suspiciousTestQuotes = await erp.query(`
    SELECT id,cliente_nome FROM orcamentos
    WHERE cliente_nome ~* '(teste|test)' ORDER BY id`);
  const erpCustomers = await erp.query('SELECT id,nome,nome_fantasia,cpf_cnpj FROM clientes');
  const olimenCustomers = await olimen.query('SELECT id,name,trade_name,tax_id FROM customers');
  const olimenNumbers = await olimen.query('SELECT id,commercial_number,quote_number FROM commercial_quotes WHERE commercial_number IS NOT NULL ORDER BY commercial_number');
  const olimenCounter = await olimen.query(`
    SELECT counter_key,last_value FROM commercial_quote_commercial_counters
    WHERE counter_key='global'`);

  const normalizeDocument = (value) => String(value || '').replace(/\D/g, '');
  const normalizeName = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
  const destinationByTax = new Map();
  const destinationByName = new Map();
  for (const customer of olimenCustomers.rows) {
    const tax = normalizeDocument(customer.tax_id);
    if (tax) destinationByTax.set(tax, [...(destinationByTax.get(tax) || []), customer]);
    for (const rawName of [customer.name, customer.trade_name]) {
      const name = normalizeName(rawName);
      if (name) destinationByName.set(name, [...(destinationByName.get(name) || []), customer]);
    }
  }
  let exactTaxMatches = 0;
  let ambiguousTaxMatches = 0;
  let exactNameOnlyMatches = 0;
  let ambiguousNameMatches = 0;
  let noCustomerMatch = 0;
  for (const customer of erpCustomers.rows) {
    const taxMatches = destinationByTax.get(normalizeDocument(customer.cpf_cnpj)) || [];
    const nameKey = normalizeName(customer.nome_fantasia || customer.nome);
    const nameMatches = destinationByName.get(nameKey) || [];
    if (taxMatches.length === 1) exactTaxMatches += 1;
    else if (taxMatches.length > 1) ambiguousTaxMatches += 1;
    else if (nameMatches.length === 1) exactNameOnlyMatches += 1;
    else if (nameMatches.length > 1) ambiguousNameMatches += 1;
    else noCustomerMatch += 1;
  }

  const root = path.resolve(erpRootPath);
  const pdfFiles = (await listFiles(root)).filter((file) => path.extname(file).toLowerCase() === '.pdf');
  const pdfCandidates = await Promise.all(pdfFiles.map(async (file) => {
    const relativePath = path.relative(root, file);
    const match = path.basename(file).match(/orcamento-(\d+)/i);
    const bytes = await fs.readFile(file);
    return {
      relative_path: relativePath,
      quote_number_candidate: match ? Number(match[1]) : null,
      byte_size: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }));
  const sourceNumbers = new Set(samples.rows.map((row) => Number(row.id)));
  const allNumberRows = await erp.query('SELECT id FROM orcamentos ORDER BY id');
  allNumberRows.rows.forEach((row) => sourceNumbers.add(Number(row.id)));
  const currentNumberSet = new Set(olimenNumbers.rows.map((row) => Number(row.commercial_number)));
  const numberConflicts = [...sourceNumbers].filter((number) => currentNumberSet.has(number)).sort((a, b) => a - b);
  const pdfQuoteNumbers = [...new Set(pdfCandidates.map((item) => item.quote_number_candidate).filter((number) => sourceNumbers.has(number)))].sort((a, b) => a - b);

  const output = {
    mode: 'READ_ONLY_DRY_RUN',
    source_system: 'ERP_UNIVERSAL',
    source_identity: 'orcamentos.id',
    generated_at: new Date().toISOString(),
    summary: summary.rows[0],
    duplicate_numbers: duplicateNumbers.rows,
    exact_content_duplicate_groups: semanticDuplicates.rows,
    missing_numbers_in_min_max_range: gaps.rows.map((row) => Number(row.missing_number)),
    statuses: statuses.rows,
    payment_audit: payments.rows[0],
    quotes_without_payment_method: noPaymentQuotes.rows.map((row) => Number(row.id)),
    payment_methods: paymentMethods.rows,
    item_issues: issues.rows[0],
    suspicious_test_quotes: suspiciousTestQuotes.rows,
    customer_matching: {
      erp_master_customers: erpCustomers.rowCount,
      exact_tax_id_matches: exactTaxMatches,
      ambiguous_tax_id_matches: ambiguousTaxMatches,
      exact_normalized_name_only_matches: exactNameOnlyMatches,
      ambiguous_normalized_name_matches: ambiguousNameMatches,
      without_candidate: noCustomerMatch,
    },
    pdf_audit: {
      persisted_official_pdf_table: false,
      official_pdfs_found: 0,
      filesystem_pdf_artifacts: pdfCandidates.length,
      quote_numbers_with_candidate_artifacts: pdfQuoteNumbers,
      candidate_artifacts: pdfCandidates,
    },
    destination_number_audit: {
      current_olimen_number_count: olimenNumbers.rowCount,
      current_olimen_minimum: olimenNumbers.rows.length ? Math.min(...olimenNumbers.rows.map((row) => Number(row.commercial_number))) : null,
      current_olimen_maximum: olimenNumbers.rows.length ? Math.max(...olimenNumbers.rows.map((row) => Number(row.commercial_number))) : null,
      current_counter_last_value: olimenCounter.rows[0] ? Number(olimenCounter.rows[0].last_value) : null,
      next_number_if_duplicated_now: olimenCounter.rows[0] ? Number(olimenCounter.rows[0].last_value) + 1 : null,
      exact_number_conflicts: numberConflicts,
    },
    source_numbers_at_or_above_250: [...sourceNumbers].filter((number) => number >= 250).sort((a, b) => a - b),
    first_quotes: samples.rows,
    blockers: Number(summary.rows[0].numbers_at_or_above_250) > 0
      ? ['ERP_NUMBER_AT_OR_ABOVE_250'] : [],
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  await Promise.allSettled([erp.query('ROLLBACK'), olimen.query('ROLLBACK')]);
  await Promise.allSettled([erp.end(), olimen.end()]);
}
