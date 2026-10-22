import { addCalendarMonths, businessToday, dateOnly } from './vacationRules.js';

export const vacationFilters = ['all', 'acquired', 'due_soon', 'overdue'];

export function alertForPeriod(period, today = businessToday()) {
  const current = dateOnly(today);
  const acquired = dateOnly(period.acquisition_end) < current;
  const unconfirmed = period.balance === null || period.balance === undefined;
  const pending = acquired && (unconfirmed || Number(period.balance) > 0);
  const due = dateOnly(period.concession_end);
  const daysRemaining = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${current}T00:00:00Z`)) / 86400000);
  const plannedBeforeDue = (period.leaves || []).filter((leave) => leave.status === 'programada' && dateOnly(leave.start_date) >= current && dateOnly(leave.end_date) <= due).reduce((sum, leave) => sum + Number(leave.days), 0);
  return {
    acquired: pending,
    due_soon: pending && daysRemaining >= 0 && due <= addCalendarMonths(current, 4),
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
