import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildLegacyQuoteDocumentData, buildQuoteDocumentData, loadFrozenQuoteCatalogs } from '../backend/src/services/commercialQuoteDocumentDataService.js';
import { buildOrcamentoPdf } from '../backend/src/services/pdf/orcamentoPdfService.js';
import { displayNumber } from '../backend/src/services/pdf/universal/renderQuote.js';

function quoteFixture(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111', quote_number: 'ORC-2026-000001', commercial_number: 250, status: 'draft',
    quote_date: '2026-08-22', valid_until: '2026-09-22', customer_id: null,
    customer_name_snapshot: 'João', customer_snapshot: { name: 'João', address: {} },
    items_gross_total: '150.00', items_discount_total: '10.00', subtotal: '140.00',
    discount_amount: '5.00', freight_amount: '15.00', total: '150.00',
    notes: 'Entrega conforme combinado.', internal_notes: 'NUNCA MOSTRAR INTERNO',
    items: [{ line_order: 1, item_type: 'manual', product_code_snapshot: 'MAN-1', product_name_snapshot: 'Instalação', measurement_unit_snapshot: 'SV', description_snapshot: 'Serviço manual', quantity: '1.000', unit_price: '150.00', discount_amount: '10.00', subtotal: '140.00', sop_minimum_price_snapshot: '999.00', is_outside_sop: true, operational_cost: '1.00' }],
    payment_methods: [{ line_order: 1, method_type: 'pix', description: '50% de entrada', calculation_type: 'percentage', percentage: '50.0000', amount: '75.00', installment_count: 1, first_due_date: '2026-08-22', notes: null, installments: [{ installment_number: 1, due_date: '2026-08-22', amount: '75.00' }] }, { line_order: 2, method_type: 'bank_slip', description: '50% na entrega', calculation_type: 'percentage', percentage: '50.0000', amount: '75.00', installment_count: 2, first_due_date: '2026-09-22', notes: null, installments: [{ installment_number: 1, due_date: '2026-09-22', amount: '37.50' }, { installment_number: 2, due_date: '2026-10-22', amount: '37.50' }] }],
    ...overrides,
  };
}

test('dados documentais usam snapshots e excluem informações internas', () => {
  const data = buildQuoteDocumentData(quoteFixture());
  const serialized = JSON.stringify(data);
  assert.equal(data.customer.name, 'João');
  assert.equal(data.items[0].type, 'manual');
  assert.match(serialized, /Entrega conforme combinado/);
  assert.doesNotMatch(serialized, /NUNCA MOSTRAR INTERNO|sop|minimum|operational|cost/i);
});

test('adapter legado preserva valores importados, identidade ERP e campos públicos', () => {
  const legacy = quoteFixture({
    commercial_number: 25,
    source_system: 'ERP_UNIVERSAL',
    source_legacy_number: 83,
    total_provenance: 'reconstructed_from_source_rows',
    calculation_version: 'ERP_UNIVERSAL_V1',
    payload_hash: 'a'.repeat(64),
  });
  const data = buildLegacyQuoteDocumentData(legacy);
  assert.equal(data.quote.commercial_number, 25);
  assert.equal(data.quote.source_reference, 'ERP original #83');
  assert.equal(data.quote.document_origin, 'RECONSTRUCTED');
  assert.deepEqual(data.totals, { gross:'150.00', item_discount:'10.00', subtotal:'140.00', general_discount:'5.00', freight:'15.00', total:'150.00' });
  assert.equal(data.provenance.calculation_version, 'ERP_UNIVERSAL_V1');
  assert.doesNotMatch(JSON.stringify(data), /NUNCA MOSTRAR INTERNO|sop|minimum|operational|cost/i);
});

test('cliente cadastrado, avulso e não identificado são representados sem consulta viva', () => {
  const registered = buildQuoteDocumentData(quoteFixture({ customer_id: '22222222-2222-4222-8222-222222222222', customer_snapshot: { name: 'Empresa Snapshot', tax_id: '123', address: {} } }));
  const freeText = buildQuoteDocumentData(quoteFixture());
  const unidentified = buildQuoteDocumentData(quoteFixture({ customer_name_snapshot: 'Cliente não identificado', customer_snapshot: { name: 'Cliente não identificado', address: {} } }));
  assert.deepEqual([registered.customer.source, freeText.customer.source, unidentified.customer.source], ['registered', 'free_text', 'unidentified']);
});

test('PDFKit gera A4 válido, multipágina e determinístico quanto ao hash do buffer', async () => {
  const manyItems = Array.from({ length: 58 }, (_, index) => ({
    ...quoteFixture().items[0], line_order: index + 1,
    product_name_snapshot: `Item ${index + 1} com nome comercial longo para validar quebra de linha e paginação`,
    description_snapshot: `Descrição extensa ${index + 1} com detalhes comerciais suficientes para ocupar mais de uma linha na tabela.`,
  }));
  const data = buildQuoteDocumentData(quoteFixture({ items: manyItems, notes: 'Observação comercial longa. '.repeat(35) }));
  const pdf = await buildOrcamentoPdf(data, { nome_fantasia: 'OliMen', razao_social: 'Torneadora Universal Ltda.', cnpj: '12345678000190', telefone: '65999999999', email: 'comercial@example.com', endereco: 'Rua Industrial', numero: '100', cidade: 'Cuiabá', estado: 'MT' }, { draft: true, emittedAt: new Date('2026-08-22T12:00:00Z') });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10_000);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1);
  assert.match(createHash('sha256').update(pdf).digest('hex'), /^[0-9a-f]{64}$/);
});

test('PDF usa o número comercial persistido sem derivar o identificador técnico', () => {
  const data = buildQuoteDocumentData(quoteFixture({ quote_number: 'ORC-2026-000123', commercial_number: 250 }));
  assert.equal(data.quote.commercial_number, 250);
  assert.equal(data.quote.technical_number, 'ORC-2026-000123');
  assert.equal(displayNumber(data.quote.commercial_number), '250');
  assert.equal(displayNumber(null), 'SEM NÚMERO COMERCIAL');
});

test('data DATE recebida do PostgreSQL mantém o ano correto no snapshot', () => {
  const data = buildQuoteDocumentData(quoteFixture({
    quote_date: new Date('2026-08-23T04:00:00.000Z'),
    valid_until: new Date('2026-09-23T04:00:00.000Z'),
  }));
  assert.equal(data.quote.date, '2026-08-23');
  assert.equal(data.quote.valid_until, '2026-09-23');
});

test('Catálogo usa exatamente a versão congelada e ignora Produto sem versão e item manual', async () => {
  const frozenVersionId = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM product_catalog_versions v')) return { rows: [{
        id: frozenVersionId, version_number: 2, status: 'archived', commercial_title: 'Moinho histórico',
        subtitle: 'Versão congelada', presentation_text: 'Apresentação comercial', applications_text: 'Mineração',
        additional_text: null, notes: 'Observação pública', product_id: '44444444-4444-4444-8444-444444444444', product_name: 'Moinho',
      }] };
      if (sql.includes('product_catalog_specifications')) return { rows: [{ id: 's1', product_catalog_version_id: frozenVersionId, name: 'Potência', value: '10', unit: 'cv', position: 0 }] };
      if (sql.includes('product_catalog_included_items')) return { rows: [{ id: 'i1', product_catalog_version_id: frozenVersionId, description: 'Proteção', quantity: null, unit: null, notes: null, position: 0 }] };
      if (sql.includes('product_catalog_images')) return { rows: [] };
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const quote = quoteFixture({ items: [
    { ...quoteFixture().items[0], item_type: 'product', product_id: '44444444-4444-4444-8444-444444444444', product_catalog_version_id: frozenVersionId },
    { ...quoteFixture().items[0], line_order: 2, item_type: 'product', product_id: '55555555-5555-4555-8555-555555555555', product_catalog_version_id: null },
    { ...quoteFixture().items[0], line_order: 3, item_type: 'manual', product_id: null, product_catalog_version_id: null },
  ] });
  const loaded = await loadFrozenQuoteCatalogs(database, quote);
  assert.equal(loaded.catalogs.length, 1);
  assert.equal(loaded.catalogs[0].version_id, frozenVersionId);
  assert.equal(loaded.catalogs[0].version_number, 2);
  assert.deepEqual(calls[0].params[0], [frozenVersionId]);
  assert.equal(calls.some(({ sql }) => /active_version_id/i.test(sql)), false);
});

test('renderer portado anexa Catálogo, suporta pagamentos múltiplos e assinatura somente quando configurada', async () => {
  const image = await sharp({ create: { width: 700, height: 460, channels: 3, background: '#278557' } }).png().toBuffer();
  const data = buildQuoteDocumentData(quoteFixture());
  data.catalogs = [{
    version_id: '33333333-3333-4333-8333-333333333333', version_number: 1,
    product_name: 'Moinho Universal H-3.5', commercial_title: 'Moinho Universal H-3.5', subtitle: 'Versão comercial',
    presentation_text: 'Descrição e apresentação do equipamento.', applications_text: 'Moagem de minérios.',
    additional_text: 'Conforme configuração congelada.', notes: null,
    specifications: [{ name: 'Capacidade', value: '3,5', unit: 't/h' }],
    included_items: [{ description: 'Conjunto principal' }, { description: 'Proteções' }],
    images: [{ id: 'img-1', is_primary: true, caption: 'Vista principal' }],
  }];
  let layout;
  const pdf = await buildOrcamentoPdf(data, {
    nome_fantasia: 'TORNEADORA UNIVERSAL', razao_social: 'Torneadora Universal Ltda.',
    nome_representante: 'Responsável real', logo: image, signature: image,
  }, {
    draft: false, emittedAt: new Date('2026-08-22T12:00:00Z'), catalogImageAssets: { 'img-1': image },
    onLayout(value) { layout = value; },
  });
  assert.deepEqual(layout.pages, ['orcamento', 'catalogo']);
  assert.deepEqual(layout.signaturePages, [0]);
  assert.ok((pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length >= 3);
});

test('fechamento reserva assinatura na última página comercial sem página exclusiva', async () => {
  const renderer = fs.readFileSync(new URL('../backend/src/services/pdf/universal/renderQuote.js', import.meta.url), 'utf8');
  const orchestrator = fs.readFileSync(new URL('../backend/src/services/pdf/orcamentoPdfService.js', import.meta.url), 'utf8');
  assert.match(renderer, /withBottomReserve\(THEME\.commercialSignatureHeight/);
  assert.match(renderer, /containSize\(signature, width, 30\)/);
  assert.doesNotMatch(renderer, /ensureCommercialSignaturePage|signatureOnly/);
  assert.doesNotMatch(orchestrator, /ensureCommercialSignaturePage/);

  let shortLayout;
  await buildOrcamentoPdf(buildQuoteDocumentData(quoteFixture({ items: [quoteFixture().items[0]] })), {
    nome_fantasia: 'TORNEADORA UNIVERSAL', nome_representante: 'Responsável real',
  }, { draft: false, onLayout(value) { shortLayout = value; } });
  assert.deepEqual(shortLayout.pages, ['orcamento']);
  assert.deepEqual(shortLayout.signaturePages, [0]);

  const mediumItems = Array.from({ length: 24 }, (_, index) => ({
    ...quoteFixture().items[0], line_order: index + 1, product_code_snapshot: `M-${index + 1}`,
    description_snapshot: `Descrição comercial média do item ${index + 1} para validar paginação.`,
  }));
  let mediumLayout;
  await buildOrcamentoPdf(buildQuoteDocumentData(quoteFixture({ items: mediumItems })), {
    nome_fantasia: 'TORNEADORA UNIVERSAL', nome_representante: 'Responsável real',
  }, { draft: false, onLayout(value) { mediumLayout = value; } });
  const mediumQuotePages = mediumLayout.pages.map((kind, index) => ({ kind, index })).filter(({ kind }) => kind === 'orcamento');
  assert.ok(mediumQuotePages.length >= 2);
  assert.equal(mediumLayout.pages.every((kind) => kind === 'orcamento'), true);
  assert.deepEqual(mediumLayout.signaturePages, [mediumQuotePages.at(-1).index]);
});

test('paginação preserva identidade do Orçamento e do Catálogo com conteúdo extenso', async () => {
  const items = Array.from({ length: 34 }, (_, index) => ({
    ...quoteFixture().items[0], line_order: index + 1, product_code_snapshot: index % 2 ? null : `P-${index + 1}`,
    product_name_snapshot: `Equipamento ${index + 1}`,
    description_snapshot: `Descrição comercial longa do equipamento ${index + 1} com acessórios, medidas e condição de fornecimento. `.repeat(index === 2 ? 8 : 2),
  }));
  const data = buildQuoteDocumentData(quoteFixture({ items, notes: 'Observação comercial extensa. '.repeat(45) }));
  data.catalogs = Array.from({ length: 3 }, (_, index) => ({
    version_id: `catalog-${index}`, version_number: index + 1, commercial_title: `Equipamento técnico ${index + 1}`,
    presentation_text: 'Apresentação técnica e comercial. '.repeat(80), applications_text: 'Aplicação industrial. '.repeat(60),
    additional_text: 'Condição pública do Catálogo. '.repeat(25), notes: null, images: [],
    specifications: Array.from({ length: 12 }, (__, spec) => ({ name: `Especificação ${spec + 1}`, value: 'Valor técnico detalhado '.repeat(3), unit: null })),
    included_items: Array.from({ length: 16 }, (__, item) => ({ description: `Item incluso ${item + 1} com descrição comercial` })),
  }));
  let layout;
  const pdf = await buildOrcamentoPdf(data, { nome_fantasia: 'TORNEADORA UNIVERSAL' }, {
    draft: true, emittedAt: new Date('2026-08-22T12:00:00Z'), onLayout(value) { layout = value; },
  });
  const quotePages = layout.pages.map((kind, index) => ({ kind, index })).filter(({ kind }) => kind === 'orcamento');
  const catalogPages = layout.pages.filter((kind) => kind === 'catalogo');
  assert.ok(quotePages.length >= 2);
  assert.ok(catalogPages.length >= 6);
  assert.deepEqual(layout.signaturePages, [quotePages.at(-1).index]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, layout.pages.length);
});
