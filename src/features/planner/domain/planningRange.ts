import type { MealPlanEntry } from '@/types/domain';
import {
  formatDateKey,
  MONTHS,
  parseDateKey,
  type CalendarMonthBounds,
  type CalendarRange,
  type PlanByDate,
} from '@/features/home';

// Days the Planner offers to plan when the user has not picked any: a week.
const DEFAULT_PLANNING_DAYS = 7;

const SHORT_MONTH_LENGTH = 3;

// Every day here is a 'YYYY-MM-DD' key, which sorts like the date it names. `todayKey` is one
// too: these rules never read the clock.

// The range the pill starts with: today and the six days after it.
export function getDefaultPlanningRange(todayKey: string): CalendarRange {
  const today = parseDateKey(todayKey);
  const lastDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + DEFAULT_PLANNING_DAYS - 1
  );

  return { start: todayKey, end: formatDateKey(lastDay) };
}

// Any day from today on can be planned, whether it already has meals or not.
export function isPlannableDate(dateKey: string, todayKey: string) {
  return dateKey >= todayKey;
}

// The calendar goes from the month of today forward, with no last month.
export function getPlanningMonthBounds(todayKey: string): CalendarMonthBounds {
  return { from: todayKey.slice(0, 7) };
}

// The meals already planned from today on, by day: the days the calendar marks as covered.
export function getPlannedDaysFrom(entries: MealPlanEntry[], todayKey: string): PlanByDate {
  const plannedDays: PlanByDate = {};

  for (const entry of entries) {
    if (entry.date < todayKey) continue;

    plannedDays[entry.date] = [...(plannedDays[entry.date] ?? []), entry];
  }

  return plannedDays;
}

function readDay(dateKey: string) {
  const [, month, day] = dateKey.split('-').map(Number);

  return { day, monthName: MONTHS[month - 1], monthKey: dateKey.slice(0, 7) };
}

/**
 * What the pill reads. Within one month: `16 - 24 Septiembre`. Across months, each day with
 * the first letters of its month, which is how Spanish shortens them: `28 Sep - 3 Oct`. With
 * a start only: `Desde 16 Septiembre`.
 */
export function formatPlanningRangeLabel({ start, end }: CalendarRange) {
  if (start === null) return 'Elegir días';

  const first = readDay(start);
  if (end === null) return `Desde ${first.day} ${first.monthName}`;
  if (end === start) return `${first.day} ${first.monthName}`;

  const last = readDay(end);
  if (last.monthKey === first.monthKey) return `${first.day} - ${last.day} ${first.monthName}`;

  const shorten = (monthName: string) => monthName.slice(0, SHORT_MONTH_LENGTH);
  return `${first.day} ${shorten(first.monthName)} - ${last.day} ${shorten(last.monthName)}`;
}

// What the pill says to a screen reader: what pressing it does, and the range it shows.
export function formatPlanningRangeButtonLabel(range: CalendarRange) {
  const action = 'Elegir los días a planificar';
  if (range.start === null) return action;

  const label = formatPlanningRangeLabel(range);
  return `${action}, ahora ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
