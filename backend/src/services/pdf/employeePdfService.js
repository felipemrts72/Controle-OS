import {
  addKeyValueRows,
  addParagraph,
  addSectionTitle,
  addTable,
  createPdfDocument,
  ensurePageSpace,
  finalizePdf,
  formatAddressBR,
  formatCpfBR,
  formatDateBR,
  formatPhoneBR,
  safeText,
} from './pdfDocument.js';

const employmentStatusLabels = {
  ativo: 'Ativo',
  afastado: 'Afastado',
  desligado: 'Desligado',
};

function formatCtps(employee) {
  return [employee.ctps_number, employee.ctps_series, employee.ctps_state].filter(Boolean).join(' / ') || '-';
}

function addSignatureLines(context) {
  ensurePageSpace(context, 150);
  const { doc, margins } = context;
  const width = doc.page.width - margins.left - margins.right;
  const labels = ['Local e data', 'Assinatura do funcionário', 'Assinatura do responsável pela empresa'];

  for (const label of labels) {
    const y = doc.y + 24;
    doc.strokeColor('#64748b').lineWidth(0.6)
      .moveTo(margins.left, y)
      .lineTo(margins.left + width, y)
      .stroke();
    doc.fillColor('#475569').font('Helvetica').fontSize(8)
      .text(label, margins.left, y + 5, { width, align: 'center' });
    doc.y = y + 32;
  }
}

export async function buildEmployeeProfilePdf({ employee, dependents = [] }, options = {}) {
  const context = createPdfDocument({
    title: 'Ficha cadastral de funcionário',
    subtitle: safeText(employee.full_name),
    institutionalName: options.institutionalName || 'Torneadora Universal',
    orientation: 'portrait',
  });

  addSectionTitle(context, '1. Dados pessoais');
  addKeyValueRows(context, [
    { label: 'Nome', value: employee.full_name },
    { label: 'CPF', value: formatCpfBR(employee.cpf) },
    { label: 'RG', value: employee.rg },
    { label: 'Nascimento', value: formatDateBR(employee.birth_date) },
    { label: 'Telefone', value: formatPhoneBR(employee.phone) },
  ]);

  addSectionTitle(context, '2. Endereço');
  addParagraph(context, formatAddressBR(employee));

  addSectionTitle(context, '3. Documentação');
  addKeyValueRows(context, [
    { label: 'CTPS', value: formatCtps(employee) },
    { label: 'PIS/PASEP', value: employee.pis_pasep },
    { label: 'Título eleitoral', value: employee.voter_registration },
    { label: 'Certificado militar', value: employee.military_certificate },
  ]);

  addSectionTitle(context, '4. Dados trabalhistas');
  addKeyValueRows(context, [
    { label: 'Admissão', value: formatDateBR(employee.admission_date) },
    { label: 'Cargo', value: employee.job_title },
    { label: 'Situação', value: employmentStatusLabels[employee.employment_status] || employee.employment_status },
  ]);

  addSectionTitle(context, '5. Dependentes');
  addTable(context, {
    columns: [
      { key: 'full_name', label: 'Nome', width: 0.5 },
      { key: 'relationship', label: 'Parentesco', width: 0.28 },
      { key: 'birth_date', label: 'Nascimento', width: 0.22, format: formatDateBR },
    ],
    rows: dependents,
    emptyMessage: 'Sem dependentes cadastrados.',
  });

  ensurePageSpace(context, 200);
  addParagraph(
    context,
    'Declaro que as informações acima são verdadeiras e autorizo seu uso para fins cadastrais, trabalhistas e administrativos da empresa, conforme aplicável.',
    { fontSize: 9, spacingAfter: 8 },
  );
  addSignatureLines(context);

  return finalizePdf(context);
}
