export const QUOTE_STATUS = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  sent: { label: 'Enviado', tone: 'info' },
  approved: { label: 'Aprovado', tone: 'success' },
  rejected: { label: 'Recusado', tone: 'danger' },
  cancelled: { label: 'Cancelado', tone: 'muted' },
};

export const PAYMENT_TYPES = [
  ['pix', 'PIX'],
  ['cash', 'À vista / dinheiro'],
  ['bank_slip', 'Boleto'],
  ['bank_transfer', 'Transferência'],
  ['debit_card', 'Cartão de débito'],
  ['credit_card', 'Cartão de crédito'],
  ['check', 'Cheque'],
  ['other', 'Outra condição'],
];

export function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '-';
}

export function quoteCommercialLabel(quote) {
  return quote?.commercial_number == null
    ? 'Orçamento sem número comercial'
    : `Orçamento #${quote.commercial_number}`;
}

export function todayInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function calculatePreview(items, discountAmount, freightAmount) {
  const rows = items.map((item) => {
    const gross = Math.round((Number(item.quantity || 0) * Number(item.unit_price || 0) + Number.EPSILON) * 100) / 100;
    const discount = Math.min(gross, Math.max(0, Number(item.discount_amount || 0)));
    return { gross, discount, subtotal: gross - discount };
  });
  const gross = rows.reduce((sum, item) => sum + item.gross, 0);
  const itemDiscount = rows.reduce((sum, item) => sum + item.discount, 0);
  const subtotal = gross - itemDiscount;
  const generalDiscount = Math.min(subtotal, Math.max(0, Number(discountAmount || 0)));
  const freight = Math.max(0, Number(freightAmount || 0));
  return { rows, gross, itemDiscount, subtotal, generalDiscount, freight, total: subtotal - generalDiscount + freight };
}
