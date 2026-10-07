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

function addDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);

  return formatDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/**
 * The first day the Planner can be asked to plan: the day after the last one that already
 * has a plan, and never before today. Every day up to the last planned one is blocked,
 * cooked or not, because the Planner plans the days that are not planned yet. The rules
 * below are all read from this day.
 */
export function getFirstPlannableDate(entries: MealPlanEntry[], todayKey: string) {
  const lastPlannedDate = entries.reduce<string | undefined>(
    (latest, entry) => (latest === undefined || entry.date > latest ? entry.date : latest),
    undefined
  );

  if (lastPlannedDate === undefined || lastPlannedDate < todayKey) return todayKey;
  return addDays(lastPlannedDate, 1);
}

// The range the pill starts with: the first plannable day and the six days after it.
export function getDefaultPlanningRange(firstPlannableDate: string): CalendarRange {
  return {
    start: firstPlannableDate,
    end: addDays(firstPlannableDate, DEFAULT_PLANNING_DAYS - 1),
  };
}

export function isPlannableDate(dateKey: string, firstPlannableDate: string) {
  return dateKey >= firstPlannableDate;
}

// The calendar goes from the month of the first plannable day forward, with no last month.
export function getPlanningMonthBounds(firstPlannableDate: string): CalendarMonthBounds {
  return { from: firstPlannableDate.slice(0, 7) };
}

/**
 * The range the Planner works with: the one the user picked while it still starts on a
 * plannable day, otherwise the default one. The plan can grow while a range is picked; once
 * it reaches the start of that range, the range is not one that can be planned any more.
 */
export function resolvePlanningRange(
  pickedRange: CalendarRange | null,
  firstPlannableDate: string
): CalendarRange {
  const isStillPlannable =
    pickedRange !== null &&
    pickedRange.start !== null &&
    isPlannableDate(pickedRange.start, firstPlannableDate);

  return isStillPlannable ? pickedRange : getDefaultPlanningRange(firstPlannableDate);
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
