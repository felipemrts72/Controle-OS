import { query } from '../database/pool.js';
import { httpError } from '../utils/httpError.js';

function comparable(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
}

export async function listMeasurementUnits({ include_inactive = 'false' } = {}) {
  const result = await query(
    `SELECT id, code, name, symbol, aliases, is_active, sort_order
     FROM measurement_units
     WHERE ($1::boolean = TRUE OR is_active = TRUE)
     ORDER BY sort_order, code`,
    [String(include_inactive) === 'true'],
  );
  return result.rows;
}

export async function resolveMeasurementUnit(value, client = { query }, { allowLegacy = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) throw httpError(400, 'Informe uma unidade de medida.', { code: 'MEASUREMENT_UNIT_REQUIRED', field: 'unit' });
  const normalized = comparable(raw);
  const result = await client.query(
    `SELECT id, code, name, symbol, is_active
       , aliases
     FROM measurement_units
     WHERE is_active = TRUE
     ORDER BY sort_order`,
  );
  const matched = result.rows.find((unit) => comparable(unit.code) === normalized
    || unit.aliases.some((alias) => comparable(alias) === normalized));
  if (matched) return { ...matched, input: raw, is_legacy: false };
  if (allowLegacy) return { code: raw, name: raw, symbol: raw, input: raw, is_legacy: true };
  throw httpError(400, `A unidade "${raw}" não pertence ao catálogo de unidades de medida.`, {
    code: 'MEASUREMENT_UNIT_INVALID', field: 'unit', value: raw,
  });
}

export async function normalizeMeasurementUnitCode(value, client) {
  return (await resolveMeasurementUnit(value, client)).code;
}

export function presentLegacyMeasurementUnit(value, knownUnits = []) {
  const raw = String(value ?? '').trim();
  const unit = knownUnits.find((item) => comparable(item.code) === comparable(raw)
    || (item.aliases || []).some((alias) => comparable(alias) === comparable(raw)));
  return unit ? { ...unit, is_legacy: false, original: raw } : { code: raw, name: raw || 'Sem unidade', symbol: raw, is_legacy: Boolean(raw), original: raw };
}
