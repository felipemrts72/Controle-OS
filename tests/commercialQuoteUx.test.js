import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const form = fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/QuoteFormPage.jsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/QuoteDetailPage.jsx', import.meta.url), 'utf8');
const list = fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/QuotesPage.jsx', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/quoteUi.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/pages/CommercialQuotesPage/CommercialQuotes.css', import.meta.url), 'utf8');
const globalCss = fs.readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('formulário aceita cliente avulso/vazio e não exige cadastro', () => {
  assert.match(form, /customer_name: customer \? customer\.name : customerQuery/);
  assert.doesNotMatch(form, /Selecione um cliente existente/);
  assert.match(form, /Cliente não identificado/);
});

test('fluxo keyboard-first trata autocomplete e não submete Enter comum', () => {
  assert.match(form, /ArrowDown/);
  assert.match(form, /ArrowUp/);
  assert.match(form, /Escape/);
  assert.match(form, /event\.preventDefault\(\)/);
  assert.match(form, /event\.shiftKey/);
  assert.match(form, /event\.target\.tagName === 'TEXTAREA'/);
  assert.match(form, /productActive >= 0/);
});

test('mobile usa cards próprios, filtros compactos e ações PDF tocáveis', () => {
  assert.match(detail, /> Baixar PDF</);
  assert.match(detail, /Imprimir/);
  assert.match(detail, /commercial-quote-detail__items-mobile/);
  assert.match(list, /commercial-quotes__cards/);
  assert.match(list, /commercial-quotes__filters-toggle/);
  assert.match(list, /aria-controls="quote-advanced-filters"/);
  assert.match(css, /@media \(max-width: 780px\)/);
  assert.match(css, /commercial-quote-detail__actions[^}]*position: static/s);
  assert.match(css, /min-height: 44px/);
});

test('campos mobile encolhem sem mascarar overflow e usam teclado apropriado', () => {
  assert.match(globalCss, /\.field__input[^}]*max-width: 100%[^}]*min-width: 0/s);
  assert.doesNotMatch(globalCss, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(form, /inputMode="decimal"/);
  assert.match(form, /inputMode="numeric"/);
  assert.match(form, /editableNumber\(item\.quantity\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*commercial-quote-form__conditions,[\s\S]*grid-template-columns: 1fr/);
});

test('sticky footer, autocomplete e viewport respeitam teclado, drawer e safe area', () => {
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(css, /padding-bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /:has\(\.field__input:focus\)[^}]*position: static/s);
  assert.match(css, /commercial-quote-form__results[^}]*z-index: 14/s);
  assert.match(form, /role="combobox"/);
  assert.match(form, /aria-activedescendant/);
});

test('listagem, detalhe e download apresentam commercial_number e preservam ORC como técnico', () => {
  assert.match(ui, /`Orçamento #\$\{quote\.commercial_number\}`/);
  assert.match(list, /quoteCommercialLabel\(row\)/);
  assert.match(detail, /quoteCommercialLabel\(quote\)/);
  assert.match(detail, /Identificador técnico: \{quote\.quote_number\}/);
  assert.match(detail, /Orcamento-\$\{quote\.commercial_number/);
});
