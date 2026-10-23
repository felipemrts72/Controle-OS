import { query } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';
import { addDays, dateOnly } from './vacationRules.js';

export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function holidayDate(rule, year) {
  if (rule.movable_rule === 'good_friday') return addDays(easterSunday(year), -2);
  if (rule.movable_rule === 'carnival_tuesday') return addDays(easterSunday(year), -47);
  if (rule.movable_rule === 'corpus_christi') return addDays(easterSunday(year), 60);
  const value = `${year}-${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
  try { return dateOnly(value); } catch { return null; }
}

export function holidaysForYear(rules, year) {
  return rules.filter((rule) => rule.active).map((rule) => ({ ...rule, date: holidayDate(rule, year) })).filter((rule) => rule.date).sort((a, b) => a.date.localeCompare(b.date));
}

export async function listHolidayRules(year = new Date().getFullYear()) {
  const value = Number(year);
  if (!Number.isInteger(value) || value < 1900 || value > 2200) throw httpError(400, 'Ano inválido.');
  const rules = (await query('SELECT * FROM holiday_rules ORDER BY month NULLS LAST, day NULLS LAST, name')).rows;
  return { year: value, rules, dates: holidaysForYear(rules, value) };
}

export async function holidayOn(date) {
  const target = dateOnly(date);
  const rules = (await query('SELECT * FROM holiday_rules WHERE active=TRUE')).rows;
  return holidaysForYear(rules, Number(target.slice(0, 4))).filter((item) => item.date === target);
}

export async function saveHolidayRule(payload, id = null) {
  const name = String(payload.name || '').trim();
  const scope = String(payload.scope || '');
  const classification = String(payload.classification || '');
  const movable = payload.movable_rule || null;
  const month = movable ? null : Number(payload.month);
  const day = movable ? null : Number(payload.day);
  if (!name || name.length > 150 || !['nacional','estadual','municipal'].includes(scope) || !['feriado_legal','ponto_facultativo','data_comemorativa','folga_empresa'].includes(classification) || (movable && !['good_friday','carnival_tuesday','corpus_christi'].includes(movable)) || (!movable && (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || !holidayDate({ month, day }, 2024)))) throw httpError(400, 'Regra de feriado inválida.');
  const legal = String(payload.legal_basis || '').trim().slice(0, 1000) || null;
  const noWork = payload.no_work === true;
  const active = payload.active !== false;
  const args = [name,month,day,movable,scope,classification,legal,noWork,active];
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw httpError(400, 'Identificador inválido.');
    const result = await query('UPDATE holiday_rules SET name=$1,month=$2,day=$3,movable_rule=$4,scope=$5,classification=$6,legal_basis=$7,no_work=$8,active=$9 WHERE id=$10 RETURNING *', [...args,id]);
    if (!result.rows[0]) throw httpError(404, 'Feriado não encontrado.');
    return result.rows[0];
  }
  return (await query('INSERT INTO holiday_rules (name,month,day,movable_rule,scope,classification,legal_basis,no_work,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',args)).rows[0];
}
