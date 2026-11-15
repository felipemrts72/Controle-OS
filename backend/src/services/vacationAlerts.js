import { addCalendarMonths, addDays, businessToday, dateOnly } from './vacationRules.js';

export const vacationFilters = ['all', 'acquired', 'due_soon', 'overdue', 'bonus_deadline', 'december', 'scheduled', 'concession_risk'];

function planningBalance(period) {
  return period.free_balance === undefined ? period.balance : period.free_balance;
}

export function activeVacationSchedules(leaves, today) {
  return (leaves || []).filter((leave) => leave.status === 'programada' && dateOnly(leave.end_date) >= today);
}

export function decemberPriority(period, year, today = businessToday()) {
  const current = dateOnly(today);
  const yearEnd = `${year}-12-31`;
  if (dateOnly(period.acquisition_end) >= current || Number(planningBalance(period) || 0) <= 0) return null;
  const due = dateOnly(period.concession_end);
  if (due < current) return 'Atrasadas';
  if (due <= yearEnd) return 'Vencem até 31 de dezembro';
  return 'Planejar para dezembro';
}

export function bonusDeadlineAlert(period, today = businessToday()) {
  const deadline = addDays(period.acquisition_end, -15);
  const days = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${dateOnly(today)}T00:00:00Z`)) / 86400000);
  const eligible = !period.special_case && days >= 0 && days <= 30 && !(period.leaves || []).some((leave) => leave.status !== 'cancelada' && Number(leave.bonus_days || 0) > 0);
  return { bonus_deadline: eligible, ...(eligible ? { bonus_deadline_date: deadline, bonus_days_remaining: days } : {}) };
}

export function alertForPeriod(period, today = businessToday()) {
  const current = dateOnly(today);
  const acquired = dateOnly(period.acquisition_end) < current;
  const unconfirmed = period.balance === null || period.balance === undefined;
  const pending = acquired && (unconfirmed || Number(period.balance) > 0);
  const due = dateOnly(period.concession_end);
  const daysRemaining = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${current}T00:00:00Z`)) / 86400000);
  const freeBalance = planningBalance(period);
  const planningPending = pending && (freeBalance == null || freeBalance > 0);
  const withinFourMonths = daysRemaining >= 0 && due <= addCalendarMonths(current, 4);
  const plannedBeforeDue = activeVacationSchedules(period.leaves, current).filter((leave) => dateOnly(leave.end_date) <= due).reduce((sum, leave) => sum + Number(leave.days), 0);
  return {
    acquired: pending,
    due_soon: planningPending && withinFourMonths,
    concession_risk: pending && withinFourMonths && !planningPending && plannedBeforeDue < Number(period.balance),
    scheduled: activeVacationSchedules(period.leaves, current).length > 0,
    overdue: pending && daysRemaining < 0,
    needs_review: pending && unconfirmed,
    days_remaining: daysRemaining,
    planned_before_due: plannedBeforeDue,
    planned_may_clear: pending && !unconfirmed && plannedBeforeDue >= Number(period.balance),
  };
}

export function decorateVacationPeriods(periods, today = businessToday()) {
  return periods.map((period) => ({ ...period, alert: alertForPeriod(period, today) }));
}

export function matchesVacationFilter(period, filter) {
  return filter === 'all' || Boolean(period.alert?.[filter]);
}
