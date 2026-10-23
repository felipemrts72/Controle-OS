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
  const bonus = active.reduce((total, leave) => total + Number(leave.bonus_days || 0), 0);
  if (active.filter((leave) => Number(leave.bonus_days || 0) > 0).length > 1) throw httpError(409, 'Já existe abono neste período aquisitivo.');
  if (active.some((leave) => !Number.isInteger(Number(leave.bonus_days || 0)) || Number(leave.bonus_days || 0) < 0) || bonus > Math.floor(entitlement / 3)) throw httpError(400, 'Abono excede um terço do direito adquirido.');
  const lengths = active.map((leave) => Number(leave.days));
  const used = lengths.reduce((total, days) => total + days, 0) + bonus;
  if (used > entitlement) throw httpError(409, `Este período possui ${entitlement} dias de direito. Já foram utilizados ou reservados ${used - Number(active.at(-1)?.days || 0) - Number(active.at(-1)?.bonus_days || 0)} dias. O novo lançamento de ${Number(active.at(-1)?.days || 0)} dias de gozo e ${Number(active.at(-1)?.bonus_days || 0)} de abono ultrapassaria o direito adquirido. Restam ${Math.max(0, entitlement - (used - Number(active.at(-1)?.days || 0) - Number(active.at(-1)?.bonus_days || 0)))} dias.`);
  const future = active.filter((leave) => leave.status === 'programada');
  if (future.some((leave) => Number(leave.days) < 5)) throw httpError(400, 'Programações futuras devem ter pelo menos 5 dias corridos.');
  if (active.length > 3) throw httpError(400, 'As férias permitem no máximo três períodos de gozo.');
  const remaining = entitlement - used;
  if (future.length && remaining > 0 && remaining < 5) throw httpError(400, `Restariam ${remaining} dias, insuficientes para uma nova fração mínima de 5 dias.`);
  if (future.length && remaining > 0 && active.length === 3) throw httpError(400, 'Não é possível deixar saldo após três períodos de gozo.');
  if (future.length && active.length > 1 && !lengths.some((days) => days >= 14) && remaining < 14) throw httpError(400, 'Esta programação impediria uma fração de pelo menos 14 dias corridos.');
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
  const balance = entitlement - taken - bonus;
  if (balance < 0) throw httpError(409, 'Correção deixaria saldo negativo.');
  return { taken, balance };
}

export function vacationBalances(entitlement, leaves) {
  const active = leaves.filter((leave) => leave.status !== 'cancelada');
  const bonus = active.reduce((sum, leave) => sum + Number(leave.bonus_days || 0), 0);
  const taken = active.filter((leave) => ['gozada', 'historica'].includes(leave.status)).reduce((sum, leave) => sum + Number(leave.days), 0);
  const planned = active.filter((leave) => leave.status === 'programada').reduce((sum, leave) => sum + Number(leave.days), 0);
  return { taken, planned, bonus, balance: entitlement == null ? null : entitlement - taken - bonus, free_balance: entitlement == null ? null : entitlement - taken - planned - bonus };
}

export function vacationStatus(period, entitlement, leaves, today = businessToday()) {
  const totals = vacationBalances(entitlement, leaves);
  if (dateOnly(period.acquisition_end) >= today) return { ...totals, status: 'A ADQUIRIR' };
  if (entitlement == null) return { ...totals, status: 'INFORMAÇÕES INSUFICIENTES' };
  if (totals.balance < 0 || totals.free_balance < 0) return { ...totals, status: 'DIVERGÊNCIA DE SALDO' };
  if (totals.balance === 0 && totals.planned === 0) return { ...totals, status: 'CONCLUÍDO — SALDO 0 DIAS' };
  if (totals.free_balance === 0 && totals.planned > 0) return { ...totals, status: 'TOTALMENTE PROGRAMADO' };
  if (dateOnly(period.concession_end) < today && totals.free_balance > 0) return { ...totals, status: 'SALDO VENCIDO' };
  if (totals.taken > 0 || totals.bonus > 0) return { ...totals, status: 'PARCIALMENTE UTILIZADO' };
  return { ...totals, status: 'DISPONÍVEL' };
}

export function vacationComplianceAlerts(leaves, source, balance) {
  const active = leaves.filter((leave) => leave.status !== 'cancelada');
  return [source === 'historical_estimate' ? 'Direito histórico estimado em 30 dias; informe o direito real se diferente.' : null,
    source === 'unresolved_absences' ? 'Faltas pendentes ou parciais exigem análise antes de calcular o direito.' : null,
    source === 'loss_review' ? 'Mais de 32 faltas injustificadas exigem análise da perda do direito e das demais hipóteses legais.' : null,
    balance != null && balance < 0 ? 'Gozo e abono excedem o direito do período.' : null,
    active.length > 3 || active.some((leave) => Number(leave.days) < 5) || (active.length > 1 && !active.some((leave) => Number(leave.days) >= 14)) ? 'Fracionamento histórico exige atenção.' : null,
  ].filter(Boolean);
}
