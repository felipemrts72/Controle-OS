import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('detalhe aberto por Abrir lista mantém ações específicas por item individual', () => {
  const page = readFileSync(new URL('../src/pages/AdvancesPage/AdvancesPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /to=\{`\/vales\/\$\{advanceList\.id\}`\}/);
  assert.match(page, /item\.entry_type === 'individual'/);
  assert.match(page, /showIndividualCorrection\(item, list\.id, 'edit'\)/);
  assert.match(page, /showIndividualCorrection\(item, list\.id, 'delete'\)/);
  assert.match(page, /item\.has_linked_installments/);
});
