import {
  addKeyValueRows,
  addParagraph,
  addSectionTitle,
  addTable,
  addTotalLine,
  createPdfDocument,
  finalizePdf,
  formatCurrencyBR,
  formatDateBR,
  safeText,
} from './pdfDocument.js';

function filterLabel(filter) {
  if (filter?.type === 'period') {
    return `Período: ${formatDateBR(filter.period?.from)} a ${formatDateBR(filter.period?.to)}`;
  }
  if (filter?.cycle) {
    const end = filter.cycle.closed_at ? ` a ${formatDateBR(filter.cycle.closed_at)}` : '';
    return `Ciclo: ${formatDateBR(filter.cycle.opened_at)}${end}`;
  }
  return '-';
}

function cycleDetails(filter) {
  if (!filter?.cycle) return '';
  const parts = [
    `Status: ${safeText(filter.cycle.status)}`,
    `Aberto por ${safeText(filter.cycle.opened_by_name)}`,
  ];
  if (filter.cycle.closed_at) parts.push(`Fechado por ${safeText(filter.cycle.closed_by_name)}`);
  return parts.join(' | ');
}

function originLabel(entry) {
  if (entry.entry_type === 'installment') return 'Parcela de vale';
  if (entry.entry_type === 'individual') return 'Vale individual';
  return 'Lista de vales';
}

function entryDetails(entry) {
  return [
    entry.source_bank ? `Banco: ${entry.source_bank}` : null,
    entry.installment_number ? `Parcela: ${entry.installment_number} de ${entry.installments_count}` : null,
    entry.original_amount ? `Total original: ${formatCurrencyBR(entry.original_amount)}` : null,
  ].filter(Boolean).join(' | ') || '-';
}

function observation(item) {
  if (item.override_used) return 'Limite ultrapassado por autorização';
  if (item.threshold_warning_confirmed) return 'Confirmado acima de 40%';
  return '-';
}

export async function buildGeneralAdvanceReportPdf(report, options = {}) {
  const context = createPdfDocument({
    title: 'Relatório geral de vales',
    subtitle: filterLabel(report.filter),
    orientation: 'portrait',
    company: options.company || {},
  });

  if (cycleDetails(report.filter)) addParagraph(context, cycleDetails(report.filter), { color: '#475569' });
  addTable(context, {
    columns: [
      { key: 'employee_name', label: 'Funcionário', width: 0.4 },
      { key: 'job_title', label: 'Cargo', width: 0.22 },
      { key: 'sector_name', label: 'Setor', width: 0.18 },
      { key: 'total_amount', label: 'Total de vales', width: 0.2, align: 'right', format: formatCurrencyBR },
    ],
    rows: report.rows,
    keepWithNextHeight: 48,
  });
  addTotalLine(context, 'Total geral', formatCurrencyBR(report.total_amount));

  return finalizePdf(context);
}

export async function buildIndividualAdvanceReportPdf(report, options = {}) {
  const context = createPdfDocument({
    title: 'Extrato individual de vales',
    subtitle: filterLabel(report.filter),
    orientation: 'portrait',
    company: options.company || {},
  });

  addSectionTitle(context, 'Funcionário');
  addKeyValueRows(context, [
    { label: 'Nome', value: report.employee.full_name },
    { label: 'Cargo', value: report.employee.job_title },
    { label: 'Setor', value: report.employee.sector_name },
  ]);

  addSectionTitle(context, 'Lançamentos');
  const entries = report.entries.map((entry) => ({
    ...entry,
    date: entry.list_date || entry.receipt_at || entry.created_at,
    origin: originLabel(entry),
    details: entryDetails(entry),
  }));
  addTable(context, {
    columns: [
      { key: 'date', label: 'Data', width: 0.16, format: formatDateBR },
      { key: 'origin', label: 'Origem', width: 0.24 },
      { key: 'details', label: 'Detalhes', width: 0.37 },
      { key: 'amount', label: 'Valor', width: 0.23, align: 'right', format: formatCurrencyBR },
    ],
    rows: entries,
    emptyMessage: 'Nenhum vale encontrado no filtro.',
    keepWithNextHeight: 48,
  });
  addTotalLine(context, 'Total de vales', formatCurrencyBR(report.total_amount));

  if (report.future_plans?.length) {
    addSectionTitle(context, 'Parcelamentos futuros');
    addTable(context, {
      columns: [
        { key: 'original_amount', label: 'Valor original', width: 0.24, align: 'right', format: formatCurrencyBR },
        { key: 'progress', label: 'Parcelas lançadas', width: 0.24 },
        { key: 'pending_count', label: 'Restantes', width: 0.16, align: 'right' },
        { key: 'pending_amount', label: 'Saldo futuro', width: 0.22, align: 'right', format: formatCurrencyBR },
        { key: 'status', label: 'Status', width: 0.14 },
      ],
      rows: report.future_plans.map((plan) => ({
        ...plan,
        progress: `${plan.posted_count} de ${plan.installments_count}`,
      })),
    });
  }

  return finalizePdf(context);
}

export async function buildAdvanceSummaryPdf(summary, options = {}) {
  const context = createPdfDocument({
    title: 'Lista de vales',
    subtitle: `Data: ${formatDateBR(summary.list_date)}`,
    orientation: 'landscape',
    company: options.company || {},
  });

  addSectionTitle(context, 'Valores da lista');
  addTable(context, {
    columns: [
      { key: 'employee_name', label: 'Funcionário', width: 0.28 },
      { key: 'job_title', label: 'Cargo', width: 0.2 },
      { key: 'sector_name', label: 'Setor', width: 0.14 },
      { key: 'pix_key', label: 'Chave Pix', width: 0.23 },
      { key: 'amount', label: 'Valor', width: 0.15, align: 'right', format: formatCurrencyBR },
    ],
    rows: summary.items,
    keepWithNextHeight: 48,
  });
  addTotalLine(context, 'Total', formatCurrencyBR(summary.total_amount));

  addSectionTitle(context, 'Conferência de limites');
  addTable(context, {
    columns: [
      { key: 'employee_name', label: 'Funcionário', width: 0.32 },
      { key: 'amount', label: 'Valor desta lista', width: 0.2, align: 'right', format: formatCurrencyBR },
      { key: 'remaining', label: 'Restante disponível', width: 0.2, align: 'right', format: formatCurrencyBR },
      { key: 'observation', label: 'Observação', width: 0.28 },
    ],
    rows: summary.items.map((item) => ({ ...item, observation: observation(item) })),
  });

  return finalizePdf(context);
}
