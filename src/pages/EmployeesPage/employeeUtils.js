export const statusLabels = {
  ativo: 'Ativo',
  afastado: 'Afastado',
  desligado: 'Desligado',
};

export const maritalStatusOptions = ['solteiro', 'casado', 'união estável', 'divorciado', 'viúvo', 'outro'];

export const documentTypes = [
  'RG',
  'CNH',
  'comprovante de endereço',
  'CTPS',
  'CPF',
  'título de eleitor',
  'certificado militar',
  'documento de dependente',
  'ficha assinada',
  'outro',
];

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function formatCpf(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return value || '-';
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatCpfPartial(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return value || '-';
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return 'Sem permissão';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(value) {
  if (!value) return '-';
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split('-');
  if (!year || !month || !day) return '-';
  return `${day}/${month}/${year}`;
}

export function toDateInput(value) {
  return value ? String(value).slice(0, 10) : '';
}
