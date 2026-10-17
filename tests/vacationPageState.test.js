import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVacationView } from '../src/pages/VacationsPage/vacationPageState.js';

const id = '11111111-1111-4111-8111-111111111111';
const list = { employees: [{ id, periods: [] }], indicators: { active: 1 } };
const detail = (periods = []) => ({ employee: { id, admission_date: '2025-03-10' }, periods, audit: [] });

test('clique no card nunca renderiza a listagem antiga como detalhe', () => {
  assert.equal(resolveVacationView(id, { key: 'list', data: list }).kind, 'loading');
  assert.equal(resolveVacationView(id, { key: id, data: detail() }).kind, 'detail');
});

test('volta à listagem ignora detalhe antigo e URL direta aguarda a resposta correta', () => {
  assert.equal(resolveVacationView('list', { key: id, data: detail() }).kind, 'loading');
  assert.equal(resolveVacationView(id, { key: null, data: null }).kind, 'loading');
  assert.equal(resolveVacationView('list', { key: 'list', data: list }).kind, 'list');
});

test('detalhe aceita períodos virtuais, múltiplos períodos e admissão recente', () => {
  assert.equal(resolveVacationView(id, { key: id, data: detail() }).kind, 'detail');
  assert.equal(resolveVacationView(id, { key: id, data: detail([{ ordinal: 1 }, { ordinal: 2 }]) }).data.periods.length, 2);
});

test('resposta vazia ou incompleta e erro de API exibem recuperação', () => {
  assert.equal(resolveVacationView(id, { key: id, data: null, error: 'Falha da API' }).kind, 'error');
  assert.equal(resolveVacationView(id, { key: id, data: {} }).kind, 'error');
  assert.equal(resolveVacationView('list', { key: 'list', data: {} }).kind, 'error');
});
