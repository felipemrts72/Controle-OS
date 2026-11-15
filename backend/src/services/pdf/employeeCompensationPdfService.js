import { createPdfDocument, addSectionTitle, addKeyValueGrid, addParagraph, ensurePageSpace, finalizePdf, formatCurrencyBR, formatDateBR } from './pdfDocument.js';

export async function buildCompensationPdf(data, company) {
  const context = createPdfDocument({ title: 'ALTERAÇÕES DE REMUNERAÇÃO', subtitle: `Relatório para contabilidade - ${String(data.month).padStart(2, '0')}/${data.year}`, company, emittedAt: new Date(), timeZone: 'America/Cuiaba' });
  addParagraph(context, 'Período definido pela data de registro. A vigência é informativa; não representa agendamento ou recálculo de folhas anteriores.');
  if (!data.rows.length) addParagraph(context, 'Nenhuma alteração registrada no mês.');
  for (const row of data.rows) {
    ensurePageSpace(context, 170);
    addSectionTitle(context, row.full_name);
    addKeyValueGrid(context, [
      { label: 'Tipo de alteração', value: row.type === 'salary' ? 'Salário' : 'Vale-alimentação' },
      { label: 'Valor anterior', value: formatCurrencyBR(row.previous_value) },
      { label: 'Novo valor', value: formatCurrencyBR(row.new_value) },
      { label: 'Diferença', value: formatCurrencyBR(row.difference) },
      { label: 'Variação salarial', value: row.percentage == null ? 'Não aplicável' : `${Number(row.percentage).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` },
      { label: 'Data do registro', value: formatDateBR(row.created_at) },
      { label: 'Vigência', value: formatDateBR(row.effective_from) },
    ]);
  }
  return finalizePdf(context);
}
