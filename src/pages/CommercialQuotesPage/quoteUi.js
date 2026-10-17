export const QUOTE_STATUS = {
  draft: { label: 'Aberto', tone: 'neutral' },
  sent: { label: 'Emitido', tone: 'info' },
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

export function decimalToUnits(value, scale = 2) {
  if (value === undefined || value === null || value === '') return 0n;
  const normalized = String(value).trim().replace(',', '.');
  const match = normalized.match(new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${scale}}))?$`));
  if (!match) return null;
  return BigInt(match[1]) * (10n ** BigInt(scale))
    + BigInt((match[2] || '').padEnd(scale, '0') || '0');
}

export function unitsToDecimal(units, scale = 2) {
  const factor = 10n ** BigInt(scale);
  return `${units / factor}.${(units % factor).toString().padStart(scale, '0')}`;
}

export function normalizeMoneyInput(value) {
  const cents = decimalToUnits(value, 2);
  return cents === null ? value : unitsToDecimal(cents, 2).replace('.', ',');
}

function multiplyRounded(quantityThousandths, cents) {
  return (quantityThousandths * cents + 500n) / 1000n;
}

function percentageAmount(totalCents, percentageTenThousandths) {
  return (totalCents * percentageTenThousandths + 500000n) / 1000000n;
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
    const quantity = decimalToUnits(item.quantity, 3) ?? 0n;
    const unitPrice = decimalToUnits(item.unit_price, 2) ?? 0n;
    const unitDiscount = decimalToUnits(item.discount_amount, 2) ?? 0n;
    const grossCents = multiplyRounded(quantity, unitPrice);
    const discountCents = multiplyRounded(quantity, unitDiscount > unitPrice ? unitPrice : unitDiscount);
    return {
      gross: Number(unitsToDecimal(grossCents, 2)),
      discount: Number(unitsToDecimal(discountCents, 2)),
      subtotal: Number(unitsToDecimal(grossCents - discountCents, 2)),
      grossCents, discountCents, subtotalCents: grossCents - discountCents,
    };
  });
  const grossCents = rows.reduce((sum, item) => sum + item.grossCents, 0n);
  const itemDiscountCents = rows.reduce((sum, item) => sum + item.discountCents, 0n);
  const subtotalCents = grossCents - itemDiscountCents;
  const requestedDiscount = decimalToUnits(discountAmount, 2) ?? 0n;
  const generalDiscountCents = requestedDiscount > subtotalCents ? subtotalCents : requestedDiscount;
  const freightCents = decimalToUnits(freightAmount, 2) ?? 0n;
  const totalCents = subtotalCents - generalDiscountCents + freightCents;
  return {
    rows,
    gross: Number(unitsToDecimal(grossCents, 2)),
    itemDiscount: Number(unitsToDecimal(itemDiscountCents, 2)),
    subtotal: Number(unitsToDecimal(subtotalCents, 2)),
    generalDiscount: Number(unitsToDecimal(generalDiscountCents, 2)),
    freight: Number(unitsToDecimal(freightCents, 2)),
    total: Number(unitsToDecimal(totalCents, 2)),
    totalCents,
  };
}

export function paymentDifference(payments, totalCents) {
  let allocated = 0n;
  for (const payment of payments) {
    if (payment.calculation_type === 'percentage') {
      const percentage = decimalToUnits(payment.percentage, 4);
      if (percentage === null) return null;
      allocated += percentageAmount(totalCents, percentage);
    } else {
      const amount = decimalToUnits(payment.amount, 2);
      if (amount === null) return null;
      allocated += amount;
    }
  }
  return totalCents - allocated;
}
