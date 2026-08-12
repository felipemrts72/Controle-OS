import { addKeyValueGrid, addParagraph, addSectionTitle, addTable, createPdfDocument, finalizePdf, formatDateBR, safeText } from './pdfDocument.js';

export async function buildPurchaseQuotePdf(quote, supplier, company) {
  const context = createPdfDocument({ title: `Solicitação de cotação ${quote.number}`, subtitle: supplier ? `Destinatário: ${supplier.trade_name || supplier.legal_name}` : 'Documento geral', company });
  addKeyValueGrid(context, [
    { label: 'Solicitação de compra', value: quote.request_number },
    { label: 'Prazo para resposta', value: formatDateBR(quote.response_deadline) },
    { label: 'Responsável', value: quote.contact_responsible_name || quote.responsible_name },
    { label: 'Contato para retorno', value: [quote.response_email, quote.response_whatsapp].filter(Boolean).join(' | ') || '-' },
  ]);
  addSectionTitle(context, 'Itens solicitados');
  addTable(context, { columns: [
    { key: 'internal_code', label: 'Código', width: 1 }, { key: 'product_name', label: 'Produto', width: 2.2 },
    { key: 'description_snapshot', label: 'Descrição', width: 2 }, { key: 'quantity', label: 'Qtd.', width: 0.7, align: 'right' },
    { key: 'unit', label: 'Un.', width: 0.7 }, { key: 'specification', label: 'Especificação', width: 2.2 },
  ], rows: quote.items.map(item=>({internal_code:item.internal_code||'-',product_name:item.internal_product_name||item.description||'-',description_snapshot:item.internal_product_name&&item.description!==item.internal_product_name?item.description:'-',quantity:item.quantity,unit:item.unit||'-',specification:item.technical_specification||'-'})) });
  addSectionTitle(context, 'Orientações');
  addParagraph(context, 'Favor informar preço, marca, prazo de entrega, condição de pagamento, validade da proposta, frete e impostos adicionais.');
  addParagraph(context, `Local de entrega: ${safeText(quote.delivery_address)}`);
  if (quote.notes) addParagraph(context, `Observações: ${quote.notes}`);
  return finalizePdf(context);
}
