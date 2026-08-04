export function formatPurchaseDate(value, emptyLabel = 'Sem prazo') {
  if (value === null || value === undefined || String(value).trim() === '') return emptyLabel;
  const raw = String(value).trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const dateTime = new Date(raw);
  if (Number.isNaN(dateTime.getTime())) return emptyLabel;
  return dateTime.toLocaleDateString('pt-BR');
}
