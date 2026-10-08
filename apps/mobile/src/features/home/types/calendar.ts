import type { LocalMealPlanByDate } from '../domain/localMealPlan';

export type PlanByDate = LocalMealPlanByDate;

export type MonthGridCell = {
  date: Date;
  isCurrentMonth: boolean;
};

// Which months the calendar can show, as 'YYYY-MM' keys.
export type CalendarMonthBounds =
  // Only these months, in ascending order.
  | { months: string[] }
  // This month and every month after it.
  | { from: string };

// How the calendar takes its height: all of its parent's, scrolling the month inside, or just
// what its content needs, for a surface without a height of its own such as a popover.
export type CalendarSizing = 'fill' | 'content';

export type CalendarProps = {
  planByDate?: PlanByDate;
  // The 'YYYY-MM-DD' days that carry the mark of a planned day, for a caller that knows which
  // days are planned without holding their meals. Default: the days `planByDate` has meals on.
  markedDates?: string[];
  selectedDate?: string | null;
  onSelectDate?: (dateString: string) => void;
  // Whether a 'YYYY-MM-DD' day can be picked. Default: the days with a plan to show.
  isDateSelectable?: (dateString: string) => boolean;
  // Default: the months that have a plan.
  monthBounds?: CalendarMonthBounds;
  // A range to draw, as 'YYYY-MM-DD' keys: both ends look selected and the days between them
  // are tinted. Display only; a tap still reports just the day through `onSelectDate`.
  rangeStart?: string | null;
  rangeEnd?: string | null;
  sizing?: CalendarSizing;
  daySize?: number;
  monthFontSize?: number;
  navFontSize?: number;
  weekdayFontSize?: number;
  dayFontSize?: number;
};
