import {
  addKeyValueGrid,
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

function addSignatureLines(context, company = {}) {
  ensurePageSpace(context, 112);
  const { doc, margins } = context;
  const width = doc.page.width - margins.left - margins.right;
  const dateY = doc.y + 18;
  doc.strokeColor('#64748b').lineWidth(0.6).moveTo(margins.left, dateY).lineTo(margins.left + width, dateY).stroke();
  doc.fillColor('#475569').font('Helvetica').fontSize(8).text('Local e data', margins.left, dateY + 5, { width, align: 'center' });

  const gap = 24;
  const signatureWidth = (width - gap) / 2;
  const signatureY = dateY + 48;
  const representative = [company.nome_representante, company.cargo_representante].filter(Boolean).join(' - ');
  const signatures = [
    { x: margins.left, label: 'Assinatura do funcionário' },
    { x: margins.left + signatureWidth + gap, label: representative || 'Assinatura do responsável pela empresa' },
  ];
  signatures.forEach(({ x, label }) => {
    doc.strokeColor('#64748b').lineWidth(0.6).moveTo(x, signatureY).lineTo(x + signatureWidth, signatureY).stroke();
    doc.fillColor('#475569').font('Helvetica').fontSize(8).text(label, x, signatureY + 5, { width: signatureWidth, align: 'center' });
  });
  doc.y = signatureY + 28;
}

export async function buildEmployeeProfilePdf({ employee, dependents = [] }, options = {}) {
  const company = options.company || {};
  const context = createPdfDocument({
    title: 'Ficha cadastral de funcionário',
    subtitle: safeText(employee.full_name),
    company,
    orientation: 'portrait',
    margins: { top: 32, right: 38, bottom: 46, left: 38 },
  });

  addSectionTitle(context, '1. Dados pessoais');
  addKeyValueGrid(context, [
    { label: 'Nome', value: employee.full_name },
    { label: 'CPF', value: formatCpfBR(employee.cpf) },
    { label: 'RG', value: employee.rg },
    { label: 'Nascimento', value: formatDateBR(employee.birth_date) },
    { label: 'Telefone', value: formatPhoneBR(employee.phone) },
  ]);

  addSectionTitle(context, '2. Endereço');
  addParagraph(context, formatAddressBR(employee), { spacingAfter: 7 });

  addSectionTitle(context, '3. Documentação');
  addKeyValueGrid(context, [
    { label: 'CTPS', value: formatCtps(employee) },
    { label: 'PIS/PASEP', value: employee.pis_pasep },
    { label: 'Título eleitoral', value: employee.voter_registration },
    { label: 'Certificado militar', value: employee.military_certificate },
  ]);

  addSectionTitle(context, '4. Dados trabalhistas');
  addKeyValueGrid(context, [
    { label: 'Admissão', value: formatDateBR(employee.admission_date) },
    { label: 'Cargo', value: employee.job_title },
    { label: 'Setor', value: employee.sector_name },
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
    keepWithNextHeight: 145,
  });

  ensurePageSpace(context, 145);
  addParagraph(
    context,
    'Declaro que as informações acima são verdadeiras e autorizo seu uso para fins cadastrais, trabalhistas e administrativos da empresa, conforme aplicável.',
    { fontSize: 9, spacingAfter: 5 },
  );
  addSignatureLines(context, company);

  return finalizePdf(context);
}
