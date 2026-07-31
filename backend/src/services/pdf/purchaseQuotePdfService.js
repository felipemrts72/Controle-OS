import { addKeyValueGrid, addParagraph, addSectionTitle, addTable, createPdfDocument, finalizePdf, formatDateBR, safeText } from './pdfDocument.js';

export async function buildPurchaseQuotePdf(quote, supplier, company) {
  const context = createPdfDocument({ title: `Solicitação de cotação ${quote.number}`, subtitle: supplier ? `Destinatário: ${supplier.trade_name || supplier.legal_name}` : 'Documento geral', company });
  addKeyValueGrid(context, [
    { label: 'Solicitação de compra', value: quote.request_number },
    { label: 'Prazo para resposta', value: formatDateBR(quote.response_deadline) },
    { label: 'Responsável', value: quote.responsible_name },
    { label: 'Contato para retorno', value: [quote.response_email, quote.response_whatsapp].filter(Boolean).join(' | ') || '-' },
  ]);
  addSectionTitle(context, 'Itens solicitados');
  addTable(context, { columns: [
    { key: 'description', label: 'Descrição', width: 3 }, { key: 'quantity', label: 'Qtd.', width: 0.8, align: 'right' },
    { key: 'unit', label: 'Un.', width: 0.7 }, { key: 'technical_specification', label: 'Especificação', width: 3 },
  ], rows: quote.items });
  addSectionTitle(context, 'Orientações');
  addParagraph(context, 'Favor informar preço, marca, prazo de entrega, condição de pagamento, validade da proposta, frete e impostos adicionais.');
  addParagraph(context, `Local de entrega: ${safeText(quote.delivery_address)}`);
  if (quote.notes) addParagraph(context, `Observações: ${quote.notes}`);
  return finalizePdf(context);
}

