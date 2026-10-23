const leap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const monthDays = (year, month) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

function parts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y); const month = Number(m); const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) return null;
  return { year, month, day };
}

const pad = (number) => String(number).padStart(2, '0');
const format = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

export function addCivilDays(value, offset) {
  const date = parts(value);
  if (!date || !Number.isInteger(offset) || offset < 0 || offset > 366) return '';
  for (let day = 0; day < offset; day += 1) {
    date.day += 1;
    if (date.day > monthDays(date.year, date.month)) {
      date.day = 1; date.month += 1;
      if (date.month > 12) { date.month = 1; date.year += 1; }
    }
  }
  return format(date);
}

export function endFromDays(start, days) {
  const count = Number(days);
  return Number.isInteger(count) && count >= 1 && count <= 366 ? addCivilDays(start, count - 1) : '';
}

export function inclusiveCivilDays(start, end) {
  const a = parts(start); const b = parts(end);
  if (!a || !b) return 0;
  const ordinal = ({ year, month, day }) => {
    let total = 365 * (year - 1) + Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400) + day;
    for (let m = 1; m < month; m += 1) total += monthDays(year, m);
    return total;
  };
  return Math.max(0, ordinal(b) - ordinal(a) + 1);
}

export function updateVacationDates(current, patch) {
  const updated = { ...current, ...patch };
  return { ...updated, end_date: endFromDays(updated.start_date, updated.days) };
}
