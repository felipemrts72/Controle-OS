import { query, transaction } from '../database/pool.js';
import { createHash } from 'node:crypto';
import { httpError } from '../utils/httpError.js';
import { addCalendarMonths, addDays, article130Days, businessToday, calendarDays, dateOnly, monthsInPeriod, periodsFromAdmission, validateFractions, validateLeaveCollection, vacationBalances } from './vacationRules.js';
import { decorateVacationPeriods, matchesVacationFilter, vacationFilters } from './vacationAlerts.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value) { if (!uuid.test(String(value))) throw httpError(400, 'Identificador inválido.'); return value; }
function note(value) { const text = String(value || '').trim(); if (text.length > 3000) throw httpError(400, 'Observação muito longa.'); return text || null; }
async function audit(client, employeeId, periodId, type, entityId, action, before, after, actor, reason = null) {
  await client.query('INSERT INTO vacation_audit (employee_id, period_id, entity_type, entity_id, action, before_data, after_data, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [employeeId, periodId, type, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actor, reason]);
}
async function employee(client, employeeId, lock = false) {
  const result = await client.query(`SELECT id, full_name, admission_date, employment_status FROM employees WHERE id=$1 AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`, [id(employeeId)]);
  if (!result.rows[0]) throw httpError(404, 'Funcionário não encontrado.');
  return result.rows[0];
}
function periodId(employeeId, ordinal) {
  const hex = createHash('sha256').update(`olimen-vacation-period:${employeeId}:${ordinal}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function visiblePeriods(person, existing, today = businessToday()) {
  if (!person.admission_date) return existing.map((period) => ({ ...period, special_case: true }));
  const generated = periodsFromAdmission(person.admission_date, today);
  const mismatch = existing.some((stored) => {
    const expected = generated.find((item) => item.ordinal === stored.ordinal);
    return !expected || dateOnly(stored.acquisition_start) !== expected.acquisition_start || dateOnly(stored.acquisition_end) !== expected.acquisition_end;
  });
  if (mismatch) return existing.map((period) => ({ ...period, special_case: true }));
  const byOrdinal = new Map(existing.map((period) => [period.ordinal, period]));
  return generated.map((period) => byOrdinal.get(period.ordinal) || {
    ...period, id: periodId(person.id, period.ordinal), employee_id: person.id,
    reviewed_at: null, reviewed_by: null, review_note: null, special_case: false,
  });
}
async function ensurePeriods(client, person, requestedId) {
  if (!person.admission_date) {
    const prior = (await client.query('SELECT * FROM vacation_periods WHERE employee_id=$1 AND special_case=FALSE', [person.id])).rows;
    for (const period of prior) {
      const after = (await client.query('UPDATE vacation_periods SET special_case=TRUE WHERE id=$1 RETURNING *', [period.id])).rows[0];
      await audit(client, person.id, period.id, 'period', period.id, 'admission_missing', period, after, null);
    }
    return [];
  }
  const generated = periodsFromAdmission(person.admission_date);
  const existing = (await client.query('SELECT * FROM vacation_periods WHERE employee_id=$1', [person.id])).rows;
  const mismatch = existing.some((stored) => {
    const expected = generated.find((item) => item.ordinal === stored.ordinal);
    return !expected || dateOnly(stored.acquisition_start) !== expected.acquisition_start || dateOnly(stored.acquisition_end) !== expected.acquisition_end;
  });
  if (mismatch) {
    for (const period of existing.filter((item) => !item.special_case)) {
      const after = (await client.query('UPDATE vacation_periods SET special_case=TRUE WHERE id=$1 RETURNING *', [period.id])).rows[0];
      await audit(client, person.id, period.id, 'period', period.id, 'admission_changed', period, after, null);
    }
    return generated;
  }
  for (const period of generated.filter((item) => periodId(person.id, item.ordinal) === requestedId)) {
    await client.query(`INSERT INTO vacation_periods (id, employee_id, ordinal, acquisition_start, acquisition_end, concession_start, concession_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (employee_id, ordinal) DO NOTHING`, [periodId(person.id, period.ordinal), person.id, period.ordinal, period.acquisition_start, period.acquisition_end, period.concession_start, period.concession_end]);
  }
  return generated;
}
async function periodForDate(client, person, occurrenceDate) {
  const date = dateOnly(occurrenceDate);
  if (!person.admission_date || date < dateOnly(person.admission_date) || date > businessToday()) throw httpError(400, 'Data fora do contrato ou no futuro.');
  const acquisition = periodsFromAdmission(person.admission_date).find((item) => date >= item.acquisition_start && date <= item.acquisition_end);
  if (!acquisition) throw httpError(400, 'Período aquisitivo não encontrado para a data.');
  await ensurePeriods(client, person, periodId(person.id, acquisition.ordinal));
  const found = await client.query('SELECT * FROM vacation_periods WHERE employee_id=$1 AND $2::date BETWEEN acquisition_start AND acquisition_end', [person.id, date]);
  if (!found.rows[0]) throw httpError(400, 'Período aquisitivo não encontrado para a data.');
  if (found.rows[0].special_case) throw httpError(409, 'Período com divergência cadastral; encaminhe para conferência de RH.');
  return found.rows[0];
}
function summarize(period, absences, leaves, today = businessToday()) {
  const full = absences.filter((row) => row.classification === 'injustificada' && Number(row.quantity) === 1).length;
  const half = absences.filter((row) => row.classification === 'injustificada' && Number(row.quantity) === 0.5).length;
  const justified = absences.filter((row) => row.classification === 'justificada').length;
  const pending = absences.filter((row) => row.classification === 'pendente').length;
  const reviewed = Boolean(period.reviewed_at) && !period.special_case && pending === 0 && half === 0 && today > dateOnly(period.acquisition_end);
  const entitlement = reviewed ? article130Days(full) : null;
  const { taken, planned, balance, free_balance } = vacationBalances(entitlement, leaves);
  let status = today <= dateOnly(period.acquisition_end) && !period.special_case ? 'EM AQUISIÇÃO' : 'PENDENTE DE CONFERÊNCIA';
  if (reviewed) {
    if (balance <= 0) status = 'QUITADO';
    else if (dateOnly(period.concession_end) < today) status = 'PRAZO CONCESSIVO VENCIDO';
    else if (dateOnly(period.concession_end) <= addCalendarMonths(today, 4)) status = 'PRÓXIMO DO VENCIMENTO';
    else if (taken > 0) status = 'PARCIALMENTE GOZADO';
    else if (planned > 0) status = 'PROGRAMADO';
    else status = 'DISPONÍVEL';
  }
  const months = monthsInPeriod(dateOnly(period.acquisition_start), dateOnly(period.acquisition_end)).map((month) => ({ ...month, absences: absences.filter((row) => dateOnly(row.occurrence_date).slice(0, 7) === month.month) }));
  return { ...period, status, entitlement, planned, taken, balance, free_balance, full_unjustified: full, half_unjustified: half, justified, pending, months, absences, leaves: leaves.map((leave) => ({ ...leave, temporal_status: leave.status === 'cancelada' ? 'cancelada' : dateOnly(leave.start_date) > today ? 'futura' : dateOnly(leave.end_date) < today ? 'encerrada' : 'em andamento', compliance_warnings: [dateOnly(leave.end_date) > dateOnly(period.concession_end) ? 'Fora do prazo concessivo' : null, leave.status === 'historica' && !leave.notice_date ? 'Aviso não documentado' : null, leave.status === 'programada' && (!leave.notice_date || calendarDays(leave.notice_date, leave.start_date) - 1 < 30) ? 'Aviso inferior a 30 dias ou não registrado' : null].filter(Boolean) })) };
}

export async function listVacationAgenda(options = {}) {
  const start = dateOnly(options.start_date || businessToday());
  const end = dateOnly(options.end_date || addCalendarMonths(start, 1));
  if (end < start) throw httpError(400, 'Intervalo da agenda inválido.');
  if (calendarDays(start, end) > 366) throw httpError(400, 'Consulte no máximo 366 dias.');
  const status = String(options.status || '');
  if (status && !['programada', 'em_andamento', 'gozada', 'historica', 'cancelada'].includes(status)) throw httpError(400, 'Situação inválida.');
  const employeeName = String(options.employee || '').trim().slice(0, 100);
  const sectorName = String(options.sector || '').trim().slice(0, 100);
  const rows = (await query(`SELECT l.id, l.employee_id, l.period_id, l.start_date, l.end_date, l.days, l.status, l.notes,
      e.full_name AS employee_name, e.sector_id, s.name AS sector_name,
      (l.status<>'cancelada' AND e.sector_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM vacation_leaves other_leave JOIN employees other_employee ON other_employee.id=other_leave.employee_id
        WHERE other_leave.id<>l.id AND other_leave.employee_id<>l.employee_id AND other_leave.status<>'cancelada'
          AND other_employee.deleted_at IS NULL AND other_employee.sector_id=e.sector_id
          AND other_leave.start_date<=l.end_date AND other_leave.end_date>=l.start_date
      )) AS sector_overlap
    FROM vacation_leaves l JOIN employees e ON e.id=l.employee_id
    LEFT JOIN sectors s ON s.id=e.sector_id
    WHERE e.deleted_at IS NULL AND l.start_date <= $2::date AND l.end_date >= $1::date
      AND ($3::text='' OR e.full_name ILIKE '%' || $3 || '%') AND ($4::text='' OR s.name ILIKE '%' || $4 || '%')
      AND (($5::text='' AND l.status<>'cancelada') OR l.status=$5 OR ($5='em_andamento' AND l.status='programada' AND l.start_date<=$6::date AND l.end_date>=$6::date))
    ORDER BY l.start_date, e.full_name, l.id`, [start, end, employeeName, sectorName, status, businessToday()])).rows;
  return { start_date: start, end_date: end, items: rows.map((row) => ({ ...row,
    temporal_status: row.status === 'cancelada' ? 'cancelada' : dateOnly(row.start_date) > businessToday() ? 'futura' : dateOnly(row.end_date) < businessToday() ? 'encerrada' : 'em andamento',
    sector_overlap: row.sector_overlap,
  })) };
}
export async function listVacationEmployees(options = {}) {
  const legacy = typeof options === 'string';
  const { search = '', filter = 'all', status = '', page = 1 } = legacy ? { search: options } : options;
  if (!vacationFilters.includes(filter)) throw httpError(400, 'Filtro de férias inválido.');
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw httpError(400, 'Página inválida.');
  const today = businessToday();
  const items = await transaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    const people = (await client.query(`SELECT id, full_name, admission_date, employment_status FROM employees WHERE deleted_at IS NULL AND employment_status='ativo' AND full_name ILIKE $1 ORDER BY full_name`, [`%${String(search).slice(0, 100)}%`])).rows;
    if (!people.length) return [];
    const employeeIds = people.map((person) => person.id);
    const periodRows = await client.query('SELECT * FROM vacation_periods WHERE employee_id = ANY($1::uuid[]) ORDER BY ordinal DESC', [employeeIds]);
    const absenceRows = await client.query('SELECT * FROM vacation_absences WHERE employee_id = ANY($1::uuid[]) AND cancelled_at IS NULL ORDER BY occurrence_date', [employeeIds]);
    const leaveRows = await client.query('SELECT * FROM vacation_leaves WHERE employee_id = ANY($1::uuid[]) ORDER BY start_date', [employeeIds]);
    const group = (rows) => rows.reduce((map, row) => { if (!map.has(row.employee_id)) map.set(row.employee_id, []); map.get(row.employee_id).push(row); return map; }, new Map());
    const existingByEmployee = group(periodRows.rows);
    const absencesByEmployee = group(absenceRows.rows);
    const leavesByEmployee = group(leaveRows.rows);
    return people.map((person) => {
      const periods = visiblePeriods(person, existingByEmployee.get(person.id) || [], today).sort((a, b) => b.ordinal - a.ordinal);
      const absences = absencesByEmployee.get(person.id) || [];
      const leaves = leavesByEmployee.get(person.id) || [];
      return { ...person, periods: decorateVacationPeriods(periods.map((period) => summarize(period, absences.filter((item) => item.period_id === period.id), leaves.filter((item) => item.period_id === period.id), today)), today) };
    });
  });
  const inStatus = (period) => !status || period.status === status;
  const indicatorItems = status ? items.filter((item) => item.periods.some(inStatus)) : items;
  const indicators = {
    active: indicatorItems.length,
    acquired: indicatorItems.filter((item) => item.periods.some((period) => inStatus(period) && period.alert.acquired)).length,
    due_soon: indicatorItems.filter((item) => item.periods.some((period) => inStatus(period) && period.alert.due_soon)).length,
    overdue: indicatorItems.filter((item) => item.periods.some((period) => inStatus(period) && period.alert.overdue)).length,
    available: indicatorItems.filter((item) => item.periods.some((period) => inStatus(period) && period.status === 'DISPONÍVEL')).length,
    near_due: indicatorItems.filter((item) => item.periods.some((period) => inStatus(period) && period.status === 'PRÓXIMO DO VENCIMENTO')).length,
    on_leave: indicatorItems.filter((item) => item.periods.some((period) => inStatus(period) && period.leaves.some((leave) => ['gozada', 'historica'].includes(leave.status) && dateOnly(leave.start_date) <= today && dateOnly(leave.end_date) >= today))).length,
    pending: indicatorItems.reduce((sum, item) => sum + item.periods.filter((period) => inStatus(period) && period.status === 'PENDENTE DE CONFERÊNCIA').length, 0),
  };
  const filtered = items.filter((item) => item.periods.some((period) => matchesVacationFilter(period, filter) && (!status || period.status === status)) || (filter === 'all' && !status && item.periods.length === 0));
  if (filter === 'due_soon') filtered.sort((a, b) => {
    const closest = (item) => item.periods.filter((period) => period.alert.due_soon).map((period) => dateOnly(period.concession_end)).sort()[0];
    return closest(a).localeCompare(closest(b)) || a.full_name.localeCompare(b.full_name, 'pt-BR');
  });
  const pageSize = 20;
  return { indicators, employees: legacy ? filtered : filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), total: filtered.length, page: pageNumber, page_size: pageSize };
}
export async function getEmployeeVacations(employeeId) {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    const person = await employee(client, employeeId);
    const existing = (await client.query('SELECT * FROM vacation_periods WHERE employee_id=$1 ORDER BY ordinal DESC', [person.id])).rows;
    const periods = visiblePeriods(person, existing).sort((a, b) => b.ordinal - a.ordinal);
    const absences = (await client.query('SELECT * FROM vacation_absences WHERE employee_id=$1 AND cancelled_at IS NULL ORDER BY occurrence_date', [person.id])).rows;
    const leaves = (await client.query('SELECT * FROM vacation_leaves WHERE employee_id=$1 ORDER BY start_date', [person.id])).rows;
    const auditRows = (await client.query('SELECT a.*, u.name AS actor_name FROM vacation_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.employee_id=$1 ORDER BY a.created_at DESC LIMIT 100', [person.id])).rows;
    return { employee: person, periods: periods.map((p) => summarize(p, absences.filter((a) => a.period_id === p.id), leaves.filter((l) => l.period_id === p.id))), audit: auditRows };
  });
}
export async function saveAbsence(employeeId, payload, actor, absenceId = null) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    const period = await periodForDate(client, person, payload.occurrence_date);
    const quantity = Number(payload.quantity);
    if (![0.5, 1].includes(quantity) || !['justificada', 'injustificada', 'pendente'].includes(payload.classification)) throw httpError(400, 'Quantidade ou classificação inválida.');
    const before = absenceId ? (await client.query('SELECT * FROM vacation_absences WHERE id=$1 AND employee_id=$2 AND cancelled_at IS NULL FOR UPDATE', [id(absenceId), person.id])).rows[0] : null;
    if (absenceId && !before) throw httpError(404, 'Falta não encontrada.');
    const duplicate = await client.query('SELECT id FROM vacation_absences WHERE employee_id=$1 AND occurrence_date=$2 AND cancelled_at IS NULL AND id IS DISTINCT FROM $3', [person.id, dateOnly(payload.occurrence_date), absenceId]);
    if (duplicate.rowCount) throw httpError(409, 'Já existe uma falta nessa data.');
    const result = absenceId
      ? await client.query('UPDATE vacation_absences SET period_id=$1, occurrence_date=$2, quantity=$3, classification=$4, notes=$5, updated_by=$6, updated_at=NOW() WHERE id=$7 RETURNING *', [period.id, dateOnly(payload.occurrence_date), quantity, payload.classification, note(payload.notes), actor, absenceId])
      : await client.query('INSERT INTO vacation_absences (employee_id, period_id, occurrence_date, quantity, classification, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [person.id, period.id, dateOnly(payload.occurrence_date), quantity, payload.classification, note(payload.notes), actor]);
    const after = result.rows[0];
    await client.query('UPDATE vacation_periods SET reviewed_at=NULL, reviewed_by=NULL WHERE id=$1', [period.id]);
    if (before && before.period_id !== period.id) await client.query('UPDATE vacation_periods SET reviewed_at=NULL, reviewed_by=NULL WHERE id=$1', [before.period_id]);
    await audit(client, person.id, period.id, 'absence', after.id, absenceId ? 'update' : 'create', before, after, actor);
    return after;
  });
}
export async function cancelAbsence(employeeId, absenceId, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    const before = (await client.query('SELECT * FROM vacation_absences WHERE id=$1 AND employee_id=$2 AND cancelled_at IS NULL FOR UPDATE', [id(absenceId), person.id])).rows[0];
    if (!before) throw httpError(404, 'Falta não encontrada.');
    const after = (await client.query('UPDATE vacation_absences SET cancelled_at=NOW(), updated_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [actor, before.id])).rows[0];
    await client.query('UPDATE vacation_periods SET reviewed_at=NULL, reviewed_by=NULL WHERE id=$1', [before.period_id]);
    await audit(client, person.id, before.period_id, 'absence', before.id, 'cancel', before, after, actor);
    return after;
  });
}
export async function reviewPeriod(employeeId, periodId, payload, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    await ensurePeriods(client, person, id(periodId));
    const before = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2 FOR UPDATE', [id(periodId), person.id])).rows[0];
    if (!before) throw httpError(404, 'Período não encontrado.');
    if (!person.admission_date || !periodsFromAdmission(person.admission_date).some((expected) => expected.ordinal === before.ordinal && expected.acquisition_start === dateOnly(before.acquisition_start))) throw httpError(409, 'Data de admissão diverge do período. Corrija o cadastro e revise o histórico antes da conferência.');
    if (payload.confirmed !== true || !note(payload.note)) throw httpError(400, 'Confirme a conferência e informe uma justificativa.');
    if (dateOnly(before.acquisition_end) >= businessToday()) throw httpError(409, 'A aquisição ainda não terminou.');
    const unresolved = await client.query("SELECT 1 FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL AND (classification='pendente' OR (classification='injustificada' AND quantity=0.5)) LIMIT 1", [before.id]);
    if (unresolved.rowCount) throw httpError(409, 'Resolva ocorrências pendentes e meias faltas antes de confirmar.');
    const absences = (await client.query("SELECT quantity, classification FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL", [before.id])).rows;
    const entitlement = article130Days(absences.filter((row) => row.classification === 'injustificada' && Number(row.quantity) === 1).length);
    const taken = (await client.query("SELECT COALESCE(SUM(days),0)::integer AS days FROM vacation_leaves WHERE period_id=$1 AND status IN ('gozada','historica')", [before.id])).rows[0].days;
    if (taken > entitlement) throw httpError(409, 'Férias já gozadas excedem o direito calculado; exige análise jurídica.');
    const after = (await client.query('UPDATE vacation_periods SET reviewed_at=NOW(), reviewed_by=$1, review_note=$2, special_case=FALSE WHERE id=$3 RETURNING *', [actor, note(payload.note), before.id])).rows[0];
    await audit(client, person.id, before.id, 'period', before.id, 'review', before, after, actor);
    return after;
  });
}
export async function saveLeave(employeeId, periodId, payload, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    if (person.employment_status !== 'ativo') throw httpError(409, 'Funcionário não está ativo; encaminhe para conferência de RH.');
    await ensurePeriods(client, person, id(periodId));
    const period = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2 FOR UPDATE', [id(periodId), person.id])).rows[0];
    if (!period) throw httpError(404, 'Período não encontrado.');
    if (period.special_case) throw httpError(409, 'Período com divergência cadastral; encaminhe para conferência de RH.');
    const start = dateOnly(payload.start_date); const end = dateOnly(payload.end_date);
    const days = calendarDays(start, end);
    if (start < dateOnly(period.concession_start)) throw httpError(400, 'Férias antes da aquisição do direito.');
    if (end > dateOnly(period.concession_end)) throw httpError(400, 'Férias após o prazo concessivo exigem conferência jurídica.');
    const calendarReview = note(payload.calendar_review_note);
    if (payload.employee_agreed !== true || payload.calendar_confirmed !== true || !calendarReview || calendarReview.length < 10) throw httpError(400, 'Registre a concordância e a conferência administrativa do calendário e da escala.');
    if (start <= businessToday()) throw httpError(400, 'Programação deve iniciar no futuro; use regularização para férias anteriores.');
    const absences = (await client.query('SELECT * FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL', [period.id])).rows;
    if (!period.reviewed_at || period.special_case || absences.some((a) => a.classification === 'pendente' || (a.classification === 'injustificada' && Number(a.quantity) === 0.5))) throw httpError(409, 'Período pendente de conferência.');
    const entitlement = article130Days(absences.filter((a) => a.classification === 'injustificada' && Number(a.quantity) === 1).length);
    const existing = (await client.query("SELECT * FROM vacation_leaves WHERE employee_id=$1 AND status<>'cancelada' FOR UPDATE", [person.id])).rows;
    if (existing.some((row) => start <= dateOnly(row.end_date) && end >= dateOnly(row.start_date))) throw httpError(409, 'Há férias sobrepostas para o funcionário.');
    const same = existing.filter((row) => row.period_id === period.id);
    validateFractions([...same.map((row) => row.days), days], entitlement);
    const notice = payload.notice_date ? dateOnly(payload.notice_date) : null;
    if (notice && notice > businessToday()) throw httpError(400, 'A data de entrega do aviso não pode estar no futuro.');
    const after = (await client.query(`INSERT INTO vacation_leaves (employee_id, period_id, start_date, end_date, days, status, employee_agreed, calendar_confirmed, calendar_review_note, calendar_reviewed_by, notice_date, payment_due_date, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,'programada',TRUE,TRUE,$6,$7,$8,$9,$10,$11) RETURNING *`, [person.id, period.id, start, end, days, calendarReview, actor, notice, addDays(start, -2), note(payload.notes), actor])).rows[0];
    await audit(client, person.id, period.id, 'leave', after.id, 'schedule', null, after, actor);
    return after;
  });
}
export async function editScheduledLeave(employeeId, leaveId, payload, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    const before = (await client.query('SELECT * FROM vacation_leaves WHERE id=$1 AND employee_id=$2 FOR UPDATE', [id(leaveId), person.id])).rows[0];
    if (!before) throw httpError(404, 'Férias não encontradas.');
    if (before.status !== 'programada') throw httpError(409, 'Somente férias programadas podem ser editadas.');
    if (!Number.isInteger(payload.version) || payload.version !== before.version) throw httpError(409, 'Lançamento alterado por outro usuário. Atualize a página.');
    const period = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2 FOR UPDATE', [before.period_id, person.id])).rows[0];
    if (!period?.reviewed_at || period.special_case) throw httpError(409, 'Período pendente de conferência.');
    const start = dateOnly(payload.start_date); const end = dateOnly(payload.end_date);
    const days = calendarDays(start, end);
    if (start <= businessToday() || start < dateOnly(period.concession_start) || end > dateOnly(period.concession_end)) throw httpError(400, 'Datas fora do intervalo programável.');
    const calendarReview = note(payload.calendar_review_note);
    if (payload.calendar_confirmed !== true || !calendarReview || calendarReview.length < 10) throw httpError(400, 'Confirme a revisão do calendário e da escala para as novas datas.');
    const existing = (await client.query("SELECT * FROM vacation_leaves WHERE employee_id=$1 AND id<>$2 AND status<>'cancelada' FOR UPDATE", [person.id, before.id])).rows;
    if (existing.some((row) => start <= dateOnly(row.end_date) && end >= dateOnly(row.start_date))) throw httpError(409, 'Há férias sobrepostas para o funcionário.');
    const absences = (await client.query('SELECT quantity, classification FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL', [period.id])).rows;
    if (absences.some((row) => row.classification === 'pendente' || (row.classification === 'injustificada' && Number(row.quantity) === 0.5))) throw httpError(409, 'Faltas pendentes impedem a edição.');
    const entitlement = article130Days(absences.filter((row) => row.classification === 'injustificada' && Number(row.quantity) === 1).length);
    validateLeaveCollection([...existing.filter((row) => row.period_id === period.id), { ...before, start_date: start, end_date: end, days }], entitlement);
    const after = (await client.query('UPDATE vacation_leaves SET start_date=$1,end_date=$2,days=$3,notes=$4,payment_due_date=$5,calendar_review_note=$6,calendar_reviewed_by=$7,updated_by=$7,updated_at=NOW(),version=version+1 WHERE id=$8 RETURNING *', [start, end, days, note(payload.notes), addDays(start, -2), calendarReview, actor, before.id])).rows[0];
    await audit(client, person.id, period.id, 'leave', before.id, 'edit_schedule', before, after, actor);
    return after;
  });
}
export async function changeLeave(employeeId, leaveId, action, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    const before = (await client.query('SELECT * FROM vacation_leaves WHERE id=$1 AND employee_id=$2 FOR UPDATE', [id(leaveId), person.id])).rows[0];
    if (!before) throw httpError(404, 'Férias não encontradas.');
    if (before.status !== 'programada' || !['confirm', 'cancel'].includes(action)) throw httpError(409, 'Lançamento já baixado ou cancelado.');
    if (action === 'confirm' && dateOnly(before.end_date) > businessToday()) throw httpError(400, 'Confirme o gozo após o término.');
    if (action === 'confirm') {
      const period = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2 FOR UPDATE', [before.period_id, person.id])).rows[0];
      if (!period?.reviewed_at || period.special_case) throw httpError(409, 'Período precisa de nova conferência antes da baixa.');
      const absences = (await client.query('SELECT quantity, classification FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL', [period.id])).rows;
      if (absences.some((row) => row.classification === 'pendente' || (row.classification === 'injustificada' && Number(row.quantity) === 0.5))) throw httpError(409, 'Faltas pendentes impedem a baixa.');
      const entitlement = article130Days(absences.filter((row) => row.classification === 'injustificada' && Number(row.quantity) === 1).length);
      const others = (await client.query("SELECT * FROM vacation_leaves WHERE period_id=$1 AND id<>$2 AND status<>'cancelada' FOR UPDATE", [period.id, before.id])).rows;
      validateLeaveCollection([...others, { ...before, status: 'gozada' }], entitlement);
    }
    const status = action === 'confirm' ? 'gozada' : 'cancelada';
    const after = (await client.query('UPDATE vacation_leaves SET status=$1, confirmed_by=$2, confirmed_at=NOW(), updated_by=$2, updated_at=NOW(), version=version+1 WHERE id=$3 RETURNING *', [status, actor, before.id])).rows[0];
    await audit(client, person.id, before.period_id, 'leave', before.id, action, before, after, actor);
    return after;
  });
}

export async function correctConfirmedLeave(employeeId, leaveId, payload, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    const before = (await client.query('SELECT * FROM vacation_leaves WHERE id=$1 AND employee_id=$2 FOR UPDATE', [id(leaveId), person.id])).rows[0];
    if (!before || !['gozada', 'historica'].includes(before.status)) throw httpError(409, 'Somente baixas confirmadas podem ser corrigidas nesta operação.');
    if (!Number.isInteger(payload.version) || payload.version !== before.version) throw httpError(409, 'A baixa foi alterada por outro usuário. Recarregue o histórico.');
    const reason = note(payload.reason);
    if (!reason || reason.length < 10) throw httpError(400, 'Informe um motivo com pelo menos 10 caracteres.');
    if (!['correct', 'cancel'].includes(payload.action)) throw httpError(400, 'Ação de correção inválida.');
    const period = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2 FOR UPDATE', [before.period_id, person.id])).rows[0];
    if (!period) throw httpError(409, 'Período aquisitivo não encontrado.');
    let start = dateOnly(before.start_date);
    let end = dateOnly(before.end_date);
    if (payload.action === 'correct') {
      start = dateOnly(payload.start_date);
      end = dateOnly(payload.end_date);
      calendarDays(start, end);
      if (end > businessToday() || start < dateOnly(period.concession_start)
        || (before.status === 'gozada' && end > dateOnly(period.concession_end))) {
        throw httpError(400, 'Datas incompatíveis com a baixa e o período concessivo.');
      }
    }
    const otherLeaves = (await client.query("SELECT * FROM vacation_leaves WHERE employee_id=$1 AND id<>$2 AND status<>'cancelada' FOR UPDATE", [person.id, before.id])).rows;
    const periodLeaves = otherLeaves.filter((leave) => leave.period_id === period.id);
    const corrected = payload.action === 'cancel' ? null : { ...before, start_date: start, end_date: end, days: calendarDays(start, end) };
    const activeForEmployee = corrected ? [...otherLeaves, corrected] : otherLeaves;
    for (const leave of activeForEmployee) {
      if (leave.period_id !== period.id && corrected && start <= dateOnly(leave.end_date) && end >= dateOnly(leave.start_date)) {
        throw httpError(409, 'Há férias sobrepostas em outro período aquisitivo.');
      }
    }
    const absenceRows = (await client.query('SELECT quantity, classification FROM vacation_absences WHERE period_id=$1 AND cancelled_at IS NULL', [period.id])).rows;
    const full = absenceRows.filter((row) => row.classification === 'injustificada' && Number(row.quantity) === 1).length;
    const clear = period.reviewed_at && !period.special_case
      && !absenceRows.some((row) => row.classification === 'pendente' || (row.classification === 'injustificada' && Number(row.quantity) === 0.5));
    const entitlement = clear ? article130Days(full) : null;
    if (clear) validateLeaveCollection(corrected ? [...periodLeaves, corrected] : periodLeaves, entitlement);
    else if (corrected && periodLeaves.some((leave) => start <= dateOnly(leave.end_date) && end >= dateOnly(leave.start_date))) throw httpError(409, 'Há férias sobrepostas.');
    const after = payload.action === 'cancel'
      ? (await client.query("UPDATE vacation_leaves SET status='cancelada', updated_by=$1, updated_at=NOW(), version=version+1 WHERE id=$2 RETURNING *", [actor, before.id])).rows[0]
      : (await client.query('UPDATE vacation_leaves SET start_date=$1, end_date=$2, days=$3, payment_due_date=$4, updated_by=$5, updated_at=NOW(), version=version+1 WHERE id=$6 RETURNING *', [start, end, corrected.days, addDays(start, -2), actor, before.id])).rows[0];
    if (before.status === 'historica') await client.query('UPDATE vacation_periods SET reviewed_at=NULL, reviewed_by=NULL WHERE id=$1', [period.id]);
    await audit(client, person.id, period.id, 'leave', before.id, payload.action === 'cancel' ? 'cancel_confirmed' : 'correct_confirmed', before, after, actor, reason);
    return { leave: after, balance: clear && before.status !== 'historica' ? entitlement - (corrected ? [...periodLeaves, corrected] : periodLeaves).filter((row) => ['gozada', 'historica'].includes(row.status)).reduce((sum, row) => sum + Number(row.days), 0) : null };
  });
}

export async function regularizeHistoricalLeave(employeeId, periodId, payload, actor) {
  return transaction(async (client) => {
    const person = await employee(client, employeeId, true);
    await ensurePeriods(client, person, id(periodId));
    const period = (await client.query('SELECT * FROM vacation_periods WHERE id=$1 AND employee_id=$2 FOR UPDATE', [id(periodId), person.id])).rows[0];
    if (!period) throw httpError(404, 'Período não encontrado.');
    if (period.special_case) throw httpError(409, 'Período com divergência cadastral; encaminhe para conferência de RH.');
    const start = dateOnly(payload.start_date); const end = dateOnly(payload.end_date);
    if (end > businessToday()) throw httpError(400, 'Regularização somente para férias já ocorridas.');
    if (start < dateOnly(period.concession_start)) throw httpError(400, 'Data anterior à aquisição do direito.');
    if (!note(payload.notes)) throw httpError(400, 'Informe a fonte da conferência histórica.');
    const existing = (await client.query("SELECT * FROM vacation_leaves WHERE employee_id=$1 AND status<>'cancelada' FOR UPDATE", [person.id])).rows;
    if (existing.some((row) => start <= dateOnly(row.end_date) && end >= dateOnly(row.start_date))) throw httpError(409, 'Há férias sobrepostas.');
    const days = calendarDays(start, end);
    const same = existing.filter((row) => row.period_id === period.id);
    // Histórico documenta o fato ocorrido mesmo quando há irregularidade; a conferência do período valida o direito.
    const after = (await client.query(`INSERT INTO vacation_leaves (employee_id, period_id, start_date, end_date, days, status, notes, created_by, confirmed_by, confirmed_at)
      VALUES ($1,$2,$3,$4,$5,'historica',$6,$7,$7,NOW()) RETURNING *`, [person.id, period.id, start, end, days, note(payload.notes), actor])).rows[0];
    await client.query('UPDATE vacation_periods SET reviewed_at=NULL, reviewed_by=NULL WHERE id=$1', [period.id]);
    await audit(client, person.id, period.id, 'leave', after.id, 'historical_regularization', null, after, actor);
    return after;
  });
}
