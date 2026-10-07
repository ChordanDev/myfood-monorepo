// Exportes del feature Home.
export { HomeScreen } from './screens';

// For a feature that shows the Home calendar under its own rules.
export { Calendar } from './components';
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
