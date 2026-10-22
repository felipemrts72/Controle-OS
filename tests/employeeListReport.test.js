import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { employeeListFilters, employeePage } from '../backend/src/services/employeeService.js';
import { buildEmployeeListPdf, buildEmployeeListExcel } from '../backend/src/services/employeeListReportService.js';
import { employeeRoutes } from '../backend/src/routes/employeeRoutes.js';

const sample = [
  { full_name: 'Ana Silva', admission_date: '2022-01-01', job_title: 'Costureira', sector_name: 'Produção', employment_status: 'ativo' },
  { full_name: 'Bia Souza', admission_date: '2022-08-31', job_title: 'Supervisora', sector_name: 'Produção', employment_status: 'desligado' },
];

test('intervalo inclusivo combina datas, nome e situação com parâmetros', () => {
  const result = employeeListFilters({ admission_from: '2022-01-01', admission_to: '2022-08-31', search: 'Ana', status: 'ativo' });
  assert.match(result.where, /admission_date >= \$3::date/);
  assert.match(result.where, /admission_date <= \$4::date/);
  assert.match(result.where, /employment_status = \$2/);
  assert.deepEqual(result.params, ['%ana%', 'ativo', '2022-01-01', '2022-08-31']);
});

test('cada limite é independente; datas impossíveis e intervalos invertidos são rejeitados', () => {
  assert.match(employeeListFilters({ admission_from: '2025-01-01' }).where, /admission_date >=/);
  assert.match(employeeListFilters({ admission_to: '2025-12-31' }).where, /admission_date <=/);
  assert.throws(() => employeeListFilters({ admission_from: '2025-02-30' }), /inválida/);
  assert.throws(() => employeeListFilters({ admission_from: '2025-12-31', admission_to: '2025-01-01' }), /posterior/);
});

test('paginação valida limites e relatórios preservam a permissão de impressão', () => {
  assert.deepEqual(employeePage({ page: '3', page_size: '20' }), { page: 3, pageSize: 20, offset: 40 });
  assert.throws(() => employeePage({ page: '0' }), /Paginação/);
  assert.throws(() => employeePage({ page: '1', page_size: '101' }), /Paginação/);
  for (const path of ['/report-pdf', '/report-excel']) {
    const route = employeeRoutes.stack.find((layer) => layer.route?.path === path)?.route;
    assert.ok(route);
    let error;
    route.stack[1].handle({ user: { username: 'synthetic', permissions: ['employees.view'] } }, {}, (value) => { error = value; });
    assert.equal(error?.status, 403);
    route.stack[0].handle({ user: { username: 'synthetic', permissions: ['employees.profile.print'] } }, {}, (value) => { error = value; });
    assert.equal(error?.status, 403);
    route.stack[0].handle({ user: { username: 'synthetic', permissions: ['employees.view', 'employees.profile.print'] } }, {}, (value) => { error = value; });
    assert.equal(error, undefined);
    route.stack[1].handle({ user: { username: 'synthetic', permissions: ['employees.view', 'employees.profile.print'] } }, {}, (value) => { error = value; });
    assert.equal(error, undefined);
  }
});

test('relatórios sintéticos PDF e Excel incluem registros e datas Excel', async () => {
  const query = { admission_from: '2022-01-01', admission_to: '2022-08-31' };
  const pdf = await buildEmployeeListPdf(sample, query, new Date('2026-10-21T12:00:00Z'));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const excel = await buildEmployeeListExcel(sample, query, new Date('2026-10-21T12:00:00Z'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel);
  const sheet = workbook.getWorksheet('Funcionários');
  assert.equal(sheet.getCell('A7').value, 'Ana Silva');
  assert.equal(sheet.getCell('E8').value, 'Inativo');
  assert.ok(sheet.getCell('B7').value instanceof Date);
  assert.equal(sheet.getCell('B7').numFmt, 'dd/mm/yyyy');
  const emptyPdf = await buildEmployeeListPdf([], query, new Date('2026-10-21T12:00:00Z'));
  assert.equal(emptyPdf.subarray(0, 4).toString(), '%PDF');
  const emptyExcel = await buildEmployeeListExcel([], query, new Date('2026-10-21T12:00:00Z'));
  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.load(emptyExcel);
  assert.equal(emptyWorkbook.getWorksheet('Funcionários').getCell('A7').value, null);
});
