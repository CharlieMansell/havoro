const db = require('../db/db');

// Which month a transaction counts toward, which is not always the month it
// happened in. Monthly pay lands on the last working day, so a salary dated
// 31 July is the money that funds August — leaving it in July shows a month
// with double income followed by a month with none, and a savings rate that
// swings by a full pay either way.
//
// budget_month is set per transaction (NULL = the month of its own date), so
// the answer is explicit and overridable rather than inferred at read time.
// It has to be, because the same pay can land on 31 July or 1 August
// depending on how the weekend falls, and no date rule can tell those apart
// — one needs moving and the other is already right.

// SQL for the effective month of a transaction aliased `t`. Every query that
// groups or filters by month uses this, so the dashboard and the budget page
// can't disagree about which month something is in.
const BUDGET_MONTH_SQL = "COALESCE(t.budget_month, substr(t.date, 1, 7))";

const DEFAULT_SHIFT_DAYS = 3;

// Wide enough to catch pay brought forward off a weekend — a last-working-day
// salary can arrive on the 29th when the 31st is a Sunday.
function shiftDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'budget_income_shift_days'").get();
  const n = row ? Number(row.value) : DEFAULT_SHIFT_DAYS;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SHIFT_DAYS;
}

function nextMonth(year, month) {
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

// The month an imported row should count toward, or null to just use its date.
// Only money coming in moves: an expense on the 31st was paid in that month
// whatever it was funded by. Transfers never move — they're excluded from
// budgets anyway.
function defaultBudgetMonth({ date, amount_cents, is_transfer }, days = shiftDays()) {
  if (days === 0 || is_transfer || amount_cents <= 0) return null;

  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day <= daysInMonth - days) return null;

  return nextMonth(year, month);
}

module.exports = { BUDGET_MONTH_SQL, defaultBudgetMonth, shiftDays, DEFAULT_SHIFT_DAYS };
