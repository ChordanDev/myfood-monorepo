// Exportes del feature Home.
export { HomeScreen } from './screens';

// For a feature that shows the Home calendar under its own rules, in place or in a popover.
export { Calendar, FloatingCalendar, useFloatingCalendarAnchor } from './components';
export type { FloatingCalendarProps } from './components/FloatingCalendar';
export type { FloatingCalendarAnchor } from './utils/floatingCalendarPosition';
export type {
  CalendarMonthBounds,
  CalendarProps,
  CalendarSizing,
  PlanByDate,
} from './types/calendar';
export {
  EMPTY_CALENDAR_RANGE,
  isBetweenRangeEdges,
  isDateInRange,
  isRangeComplete,
  isRangeEdge,
  selectRangeDate,
  type CalendarRange,
} from './utils/calendarRange';
export { formatDateKey, formatMonthKey, parseDateKey, startOfDay } from './utils/calendarDate';
export { MONTHS } from './constants/calendar';
