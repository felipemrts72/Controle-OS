export function parsePaymentCents(value) {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text) && !/^\d+\.\d{1,2}$/.test(text)) return 0;
  const normalized = /^\d+\.\d{1,2}$/.test(text) ? text : text.replaceAll('.', '').replace(',', '.');
  const [reais, cents = ''] = normalized.split('.');
  const amount = Number(reais) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount <= 999999999999 ? amount : 0;
}
