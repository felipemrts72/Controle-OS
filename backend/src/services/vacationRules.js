import { httpError } from '../utils/httpError.js';

export function dateOnly(value) {
  const text = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, 'Data inválida.');
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw httpError(400, 'Data inválida.');
  return text;
}

export function businessToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIME_ZONE || 'America/Cuiaba', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(value, days) {
  const date = new Date(`${dateOnly(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addCalendarMonths(value, months) {
  const [year, month, day] = dateOnly(value).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function anniversary(admission, years) {
  const [year, month, day] = dateOnly(admission).split('-').map(Number);
  const targetYear = year + years;
  // A 29 February admission uses 28 February in a non-leap target year.
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function periodsFromAdmission(admission, today = businessToday()) {
  const first = dateOnly(admission);
  const current = dateOnly(today);
  if (first > current) return [];
  const result = [];
  for (let index = 0; index < 100; index += 1) {
    const start = anniversary(first, index);
    if (start > current) break;
    const next = anniversary(first, index + 1);
    const concessionEnd = addDays(anniversary(first, index + 2), -1);
    result.push({ ordinal: index + 1, acquisition_start: start, acquisition_end: addDays(next, -1), concession_start: next, concession_end: concessionEnd });
  }
  return result;
}

export function monthsInPeriod(start, end) {
  const first = dateOnly(start).slice(0, 7);
  const last = dateOnly(end).slice(0, 7);
  const result = [];
  let [year, month] = first.split('-').map(Number);
  while (`${year}-${String(month).padStart(2, '0')}` <= last) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const monthStart = `${key}-01`;
    const monthEnd = `${key}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    result.push({ month: key, start: monthStart < start ? start : monthStart, end: monthEnd > end ? end : monthEnd });
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return result;
}

export function calendarDays(start, end) {
  const days = Math.round((Date.parse(`${dateOnly(end)}T00:00:00Z`) - Date.parse(`${dateOnly(start)}T00:00:00Z`)) / 86400000) + 1;
  if (days < 1) throw httpError(400, 'A data final deve ser igual ou posterior à inicial.');
  return days;
}

export function article130Days(fullUnjustifiedAbsences) {
  if (!Number.isInteger(fullUnjustifiedAbsences) || fullUnjustifiedAbsences < 0) throw httpError(400, 'Total de faltas inválido.');
  if (fullUnjustifiedAbsences <= 5) return 30;
  if (fullUnjustifiedAbsences <= 14) return 24;
  if (fullUnjustifiedAbsences <= 23) return 18;
  if (fullUnjustifiedAbsences <= 32) return 12;
  return 0;
}

export function validateFractions(lengths, entitlement, complete = false) {
  if (lengths.length > 3 || lengths.some((days) => !Number.isInteger(days) || days < 5)) throw httpError(400, 'As férias permitem até três frações, cada uma com no mínimo cinco dias.');
  if (lengths.reduce((sum, days) => sum + days, 0) > entitlement) throw httpError(400, 'Dias programados excedem o direito confirmado.');
  if (lengths.length > 1 && !lengths.some((days) => days >= 14)
    && (complete || lengths.length === 3 || entitlement - lengths.reduce((sum, days) => sum + days, 0) < 14)) {
    throw httpError(400, 'Uma das frações deve ter ao menos 14 dias corridos.');
  }
}

export function validateLeaveCollection(leaves, entitlement) {
  const active = leaves.filter((leave) => leave.status !== 'cancelada');
  const lengths = active.map((leave) => Number(leave.days));
  validateFractions(lengths, entitlement);
  for (let index = 0; index < active.length; index += 1) {
    for (let other = index + 1; other < active.length; other += 1) {
      if (dateOnly(active[index].start_date) <= dateOnly(active[other].end_date)
        && dateOnly(active[index].end_date) >= dateOnly(active[other].start_date)) {
        throw httpError(409, 'Há férias sobrepostas.');
      }
    }
  }
  const taken = active.filter((leave) => ['gozada', 'historica'].includes(leave.status))
    .reduce((total, leave) => total + Number(leave.days), 0);
  const balance = entitlement - taken;
  if (balance < 0) throw httpError(409, 'Correção deixaria saldo negativo.');
  return { taken, balance };
}

export function vacationBalances(entitlement, leaves) {
  const taken = leaves.filter((leave) => ['gozada', 'historica'].includes(leave.status)).reduce((sum, leave) => sum + Number(leave.days), 0);
  const planned = leaves.filter((leave) => leave.status === 'programada').reduce((sum, leave) => sum + Number(leave.days), 0);
  return { taken, planned, balance: entitlement == null ? null : entitlement - taken, free_balance: entitlement == null ? null : entitlement - taken - planned };
}
