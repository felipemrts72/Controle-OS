import {
  addKeyValueGrid,
  addParagraph,
  addSectionTitle,
  createPdfDocument,
  ensurePageSpace,
  finalizePdf,
  formatCpfBR,
  formatCnpjBR,
  formatCurrencyBR,
  formatDateBR,
  safeText,
} from './pdfDocument.js';

function addSignatures(context, award) {
  ensurePageSpace(context, 132);
  const { doc, margins } = context;
  const width = doc.page.width - margins.left - margins.right;
  const location = award.company_city_snapshot || '____________________________';
  addParagraph(context, `${location}, ${formatDateBR(award.award_date)}.`, { align: 'center', spacingAfter: 48 });

  const gap = 28;
  const signatureWidth = (width - gap) / 2;
  const y = doc.y;
  const signatures = [
    {
      x: margins.left,
      name: award.employee_name_snapshot,
      role: 'Funcionário(a)',
    },
    {
      x: margins.left + signatureWidth + gap,
      name: award.representative_name_snapshot,
      role: award.representative_job_title_snapshot,
    },
  ];

  signatures.forEach(({ x, name, role }) => {
    doc.strokeColor('#64748b').lineWidth(0.6).moveTo(x, y).lineTo(x + signatureWidth, y).stroke();
    doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(8.5)
      .text(safeText(name), x, y + 7, { width: signatureWidth, align: 'center' });
    doc.fillColor('#475569').font('Helvetica').fontSize(8)
      .text(safeText(role), x, y + 20, { width: signatureWidth, align: 'center' });
  });
  doc.y = y + 40;
}

export async function buildAwardTermPdf(award, options = {}) {
  const currentCompany = options.company || {};
  const company = {
    ...currentCompany,
    nome_fantasia: award.company_name_snapshot,
    razao_social: null,
    cnpj: award.company_cnpj_snapshot || null,
    cidade: award.company_city_snapshot || null,
  };
  const jobTitle = award.job_title_snapshot || 'Não informado';
  const sectorName = award.sector_name_snapshot || 'Não informado';
  const context = createPdfDocument({
    title: 'TERMO DE PRÊMIO POR DESEMPENHO ESPECIAL',
    subtitle: `Prêmio concedido em ${formatDateBR(award.award_date)}`,
    company,
    orientation: 'portrait',
    margins: { top: 32, right: 38, bottom: 46, left: 38 },
  });

  addSectionTitle(context, 'Identificação');
  addKeyValueGrid(context, [
    { label: 'Funcionário(a)', value: award.employee_name_snapshot },
    ...(award.employee_cpf_snapshot ? [{ label: 'CPF', value: formatCpfBR(award.employee_cpf_snapshot) }] : []),
    { label: 'Cargo', value: jobTitle },
    { label: 'Setor', value: sectorName },
    { label: 'Valor do prêmio', value: formatCurrencyBR(award.amount) },
    { label: 'Data do prêmio', value: formatDateBR(award.award_date) },
  ]);

  addParagraph(
    context,
    `A empresa ${award.company_name_snapshot}, concede ao(à) funcionário(a) ${award.employee_name_snapshot}, ocupante do cargo de ${jobTitle}, vinculado(a) ao setor ${sectorName}, um prêmio no valor de ${formatCurrencyBR(award.amount)}, em reconhecimento ao desempenho especial descrito neste documento.`,
    { fontSize: 9.5, lineGap: 3, spacingAfter: 12 },
  );

  addSectionTitle(context, 'Descrição do desempenho');
  addParagraph(context, award.performance_description, { fontSize: 9.5, lineGap: 3, spacingAfter: 14 });

  ensurePageSpace(context, 220);
  addSectionTitle(context, 'Empresa concedente');
  addKeyValueGrid(context, [
    { label: 'Empresa', value: award.company_name_snapshot },
    ...(award.company_cnpj_snapshot ? [{ label: 'CNPJ', value: formatCnpjBR(award.company_cnpj_snapshot) }] : []),
    { label: 'Representante', value: award.representative_name_snapshot },
    { label: 'Cargo do representante', value: award.representative_job_title_snapshot },
  ]);

  addSignatures(context, award);
  return finalizePdf(context);
}
