import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pool } from '../backend/src/database/pool.js';
import { buildEmployeePendingReportPdf } from '../backend/src/services/pdf/employeePendingPdfService.js';
import {
  buildEmployeePendingReportRow,
  createEmployee,
  dependentFirstName,
  getDependentPendingItems,
  updateEmployee,
} from '../backend/src/services/employeeService.js';
import { selectPendingReportItems } from '../backend/src/controllers/employeeController.js';

function completeEmployee(overrides = {}) {
  return {
    id: 'employee-1', full_name: 'Funcionário Teste', birth_date: '1990-01-01', cpf: '12345678901',
    phone: '65999999999', marital_status: 'solteiro', zip_code: '78000000', street: 'Rua A',
    address_number: '1', neighborhood: 'Centro', city: 'Cuiabá', state: 'MT', admission_date: '2026-01-01',
    job_title: 'Operador', sector_name: 'Produção', current_salary: '3000', meal_allowance: '500',
    employment_status: 'ativo', ctps_number: '123', pis_pasep: '123', voter_registration: '123',
    voter_zone: '1', voter_section: '1', rg: '123', rg_issuer: 'SSP', rg_state: 'MT',
    ...overrides,
  };
}

function completeDependent(overrides = {}) {
  return {
    id: 'dependent-1', full_name: 'Maria Eduarda da Silva', relationship: 'Filha', birth_date: '2015-01-01',
    identification_type: 'matricula', identification_number: 'MAT-1', notes: null,
    ...overrides,
  };
}

const employeeDocuments = ['RG', 'comprovante de endereço'];

function withoutLegacyLaborIdentification(overrides = {}) {
  return completeEmployee({
    ctps_number: null,
    ctps_series: null,
    ctps_state: null,
    pis_pasep: null,
    ...overrides,
  });
}

test('PIS/PASEP e identificação da CTPS física ausentes não geram pendência nem alteram contador', () => {
  const row = buildEmployeePendingReportRow(withoutLegacyLaborIdentification(), employeeDocuments, [], new Set());
  assert.equal(row.pending_count, 0);
  assert.deepEqual(row.pendencies, []);
  assert.equal(row.warnings.length, 1);
});

test('campos legados ausentes não aparecem nos relatórios geral ou individual', () => {
  const row = buildEmployeePendingReportRow(withoutLegacyLaborIdentification({ phone: null }), employeeDocuments, [], new Set());
  assert.deepEqual(row.pendencies.map((pending) => pending.type), ['employee_field:phone']);
  const general = selectPendingReportItems([row], ['employee_field:phone']);
  const individual = selectPendingReportItems([row], ['employee_field:phone']);
  assert.equal(general[0].pending_count, 1);
  assert.equal(individual[0].pending_count, 1);
  assert.doesNotMatch(JSON.stringify([...general, ...individual]), /PIS|PASEP|CTPS/i);
});

test('cadastro e edição preservam campos legados, mas permitem que permaneçam vazios', async () => {
  const actualConnect = pool.connect.bind(pool);
  const fixture = (await pool.query(
    "SELECT id FROM users WHERE is_active=TRUE AND approval_status='approved' ORDER BY id LIMIT 1",
  )).rows[0];
  assert.ok(fixture?.id, 'o teste requer um usuário ativo');
  const client = await actualConnect();
  await client.query('BEGIN');
  pool.connect = async () => ({
    query: async (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim().toUpperCase())
      ? { rows: [], rowCount: 0 }
      : client.query(sql, params),
    release() {},
  });
  const user = { id: fixture.id, username: 'employee-pending-test', permissions: ['employees.manage'] };
  const cpfSuffix = String(90000000000 + (Date.now() % 9999999999));
  const payload = withoutLegacyLaborIdentification({
    id: undefined,
    cpf: cpfSuffix,
    sector_name: undefined,
  });
  try {
    const created = await createEmployee(payload, user, { complete: true });
    assert.equal(created.pis_pasep, null);
    assert.equal(created.ctps_number, null);
    assert.equal(created.ctps_series, null);
    assert.equal(created.ctps_state, null);

    const savedWithoutLegacyFields = await updateEmployee(created.id, { phone: '65988887777' }, user);
    assert.equal(savedWithoutLegacyFields.phone, '65988887777');
    assert.equal(savedWithoutLegacyFields.pis_pasep, null);
    assert.equal(savedWithoutLegacyFields.ctps_number, null);

    const withLegacyValues = await updateEmployee(created.id, {
      pis_pasep: '123.45678.90-1', ctps_number: '12345', ctps_series: '001', ctps_state: 'MT',
    }, user);
    const preserved = await updateEmployee(created.id, { phone: '65977776666' }, user);
    assert.equal(preserved.pis_pasep, withLegacyValues.pis_pasep);
    assert.equal(preserved.ctps_number, withLegacyValues.ctps_number);
    assert.equal(preserved.ctps_series, withLegacyValues.ctps_series);
    assert.equal(preserved.ctps_state, withLegacyValues.ctps_state);

    await assert.rejects(
      createEmployee({ ...payload, cpf: '123' }, user, { complete: true }),
      /CPF inválido/,
    );
  } finally {
    pool.connect = actualConnect;
    await client.query('ROLLBACK');
    client.release();
  }
});

test('zero dependentes + pendência comum: funcionário aparece com aviso que vale zero', () => {
  const row = buildEmployeePendingReportRow(completeEmployee({ phone: null }), employeeDocuments, [], new Set());
  const selected = selectPendingReportItems([row], ['employee_field:phone']);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].pending_count, 1);
  assert.equal(selected[0].warnings.length, 1);
  assert.equal(selected[0].warnings[0].title, 'DEPENDENTES NÃO REGISTRADOS');
});

test('zero dependentes + nenhuma pendência: aviso sozinho não inclui funcionário', () => {
  const row = buildEmployeePendingReportRow(completeEmployee(), employeeDocuments, [], new Set());
  assert.equal(row.pendencies.length, 0);
  assert.equal(row.warnings.length, 1);
  assert.throws(() => selectPendingReportItems([row], ['employee_field:phone']), /Selecione ao menos uma pendência/);
});

test('dependente completo + pendência comum: aparece sem aviso de dependentes', () => {
  const dependent = completeDependent();
  const row = buildEmployeePendingReportRow(completeEmployee({ phone: null }), employeeDocuments, [dependent], new Set([dependent.id]));
  assert.equal(selectPendingReportItems([row], ['employee_field:phone']).length, 1);
  assert.deepEqual(row.warnings, []);
});

test('dependente completo + nenhuma pendência: funcionário não aparece', () => {
  const dependent = completeDependent();
  const row = buildEmployeePendingReportRow(completeEmployee(), employeeDocuments, [dependent], new Set([dependent.id]));
  assert.equal(row.pending_count, 0);
  assert.deepEqual(row.warnings, []);
});

test('documento obrigatório faltando no dependente gera pendência real e aumenta contador', () => {
  const dependent = completeDependent();
  const row = buildEmployeePendingReportRow(completeEmployee(), employeeDocuments, [dependent], new Set());
  assert.deepEqual(row.pendencies, [{
    type: 'dependent:document', type_label: 'Documento de dependente', label: 'Maria - Documento pendente',
  }]);
  assert.equal(row.pending_count, 1);
});

test('campo opcional vazio do dependente não gera pendência falsa', () => {
  const dependent = completeDependent({ notes: null });
  assert.deepEqual(getDependentPendingItems(dependent, true), []);
});

test('primeiro nome preserva acentos, ignora espaços e usa fallback neutro', () => {
  assert.equal(dependentFirstName(' Maria Eduarda da Silva '), 'Maria');
  assert.equal(dependentFirstName('João Pedro Santos'), 'João');
  assert.equal(dependentFirstName('Ana'), 'Ana');
  assert.equal(dependentFirstName(null), 'Dependente');
});

test('múltiplos dependentes são avaliados separadamente e nunca geram aviso de não cadastrados', () => {
  const maria = completeDependent({ id: 'maria' });
  const joao = completeDependent({ id: 'joao', full_name: 'João Pedro Santos', identification_number: null });
  const carlos = completeDependent({ id: 'carlos', full_name: 'Carlos Henrique Souza' });
  const row = buildEmployeePendingReportRow(
    completeEmployee(), employeeDocuments, [maria, joao, carlos], new Set(['maria', 'joao']),
  );
  assert.deepEqual(row.pendencies.map((pending) => pending.label), [
    'João - Matrícula pendente',
    'Carlos - Documento pendente',
  ]);
  assert.equal(row.pending_count, 2);
  assert.deepEqual(row.warnings, []);
  assert.doesNotMatch(JSON.stringify(row), /João Pedro|Carlos Henrique/);
});

test('seleção por tipos usa OR e filtra todos os funcionários em uma única etapa', () => {
  const phone = buildEmployeePendingReportRow(completeEmployee({ id: 'phone', phone: null }), employeeDocuments, [], new Set());
  const dependent = completeDependent();
  const dependentDocument = buildEmployeePendingReportRow(completeEmployee({ id: 'dependent' }), employeeDocuments, [dependent], new Set());
  const none = buildEmployeePendingReportRow(completeEmployee({ id: 'none' }), employeeDocuments, [dependent], new Set([dependent.id]));
  const selected = selectPendingReportItems(
    [phone, dependentDocument, none],
    ['employee_field:phone', 'dependent:document'],
  );
  assert.deepEqual(selected.map((employee) => employee.id), ['phone', 'dependent']);
});

test('PDF separa pendências de aviso e recebe somente o primeiro nome do dependente', async () => {
  const row = buildEmployeePendingReportRow(
    completeEmployee({ phone: null }), employeeDocuments,
    [completeDependent({ full_name: 'Maria Eduarda da Silva' })], new Set(),
  );
  const pdf = await buildEmployeePendingReportPdf([row], { emittedAt: new Date('2026-09-08T12:00:00Z') });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(row.pendencies.find((pending) => pending.type === 'dependent:document').label, /^Maria -/);
  assert.doesNotMatch(JSON.stringify(row.pendencies), /Eduarda|Silva/);
  assert.deepEqual(row.warnings, []);
});

test('PDF recebe somente pendências reais e ignora faltas de PIS/PASEP e CTPS física', async () => {
  const row = buildEmployeePendingReportRow(
    withoutLegacyLaborIdentification({ phone: null, birth_date: null }), employeeDocuments, [], new Set(),
  );
  const pdf = await buildEmployeePendingReportPdf([row], { emittedAt: new Date('2026-09-08T12:00:00Z') });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(row.pending_count, 2);
  assert.deepEqual(row.pendencies.map((pending) => pending.type), [
    'employee_field:birth_date',
    'employee_field:phone',
  ]);
  assert.doesNotMatch(JSON.stringify(row), /PIS|PASEP|CTPS/i);
});

test('tela e exportação usam seleção única por tipo, contador real e aviso separado', () => {
  const modal = fs.readFileSync(new URL('../src/pages/EmployeesPage/PendingReportModal.jsx', import.meta.url), 'utf8');
  const listPage = fs.readFileSync(new URL('../src/pages/EmployeesPage/EmployeesPage.jsx', import.meta.url), 'utf8');
  const detailPage = fs.readFileSync(new URL('../src/pages/EmployeesPage/EmployeeDetailPage.jsx', import.meta.url), 'utf8');
  const pdf = fs.readFileSync(new URL('../backend/src/services/pdf/employeePendingPdfService.js', import.meta.url), 'utf8');
  assert.match(modal, /availableTypes/);
  assert.match(modal, /selectedPendingCount/);
  assert.match(modal, /pending-warning/);
  assert.doesNotMatch(modal, /pending_indexes|employee\.id}:\$\{index/);
  assert.match(listPage, /pending_types: pendingTypes/);
  assert.match(detailPage, /pending_types: pendingTypes/);
  assert.match(pdf, /Aviso administrativo/);
  assert.match(pdf, /pending\.label/);
});

test('formulários mantêm PIS/PASEP e CTPS física como campos opcionais', () => {
  const service = fs.readFileSync(new URL('../backend/src/services/employeeService.js', import.meta.url), 'utf8');
  const createPage = fs.readFileSync(new URL('../src/pages/EmployeesPage/EmployeeCreatePage.jsx', import.meta.url), 'utf8');
  const quickPage = fs.readFileSync(new URL('../src/pages/EmployeesPage/EmployeeQuickCreatePage.jsx', import.meta.url), 'utf8');
  const detailPage = fs.readFileSync(new URL('../src/pages/EmployeesPage/EmployeeDetailPage.jsx', import.meta.url), 'utf8');
  const requiredFields = service.match(/const completeRequiredFields = \[([\s\S]*?)\n\];/)?.[1] || '';
  const detailRequiredFields = detailPage.match(/const required = \[([\s\S]*?)\n    \];/)?.[1] || '';

  assert.doesNotMatch(requiredFields, /ctps|pis_pasep/i);
  assert.doesNotMatch(detailRequiredFields, /ctps|pis_pasep/i);
  assert.match(createPage, /CTPS número \(opcional\)/);
  assert.match(createPage, /CTPS série \(opcional\)/);
  assert.match(createPage, /CTPS UF \(opcional\)/);
  assert.match(createPage, /PIS\/PASEP \(opcional\)/);
  assert.doesNotMatch(createPage, /name="(?:ctps_number|ctps_series|ctps_state|pis_pasep)"[^>]*required/);
  assert.match(quickPage, /Carteira de Trabalho \(opcional\)/);
  assert.match(detailPage, /PIS\/PASEP \(opcional\)/);
});
