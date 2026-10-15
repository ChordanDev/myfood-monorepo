import type { HomeMealSlot } from '../domain/localMealPlan';

export const CALENDAR_DEFAULTS = {
  daySize: 42,
  monthFontSize: 18,
  navFontSize: 20,
  weekdayFontSize: 14,
  dayFontSize: 14,
};

// Space under each row of days, and the most rows a month takes.
export const DAY_ROW_GAP = 8;
export const MAX_WEEK_ROWS = 6;

// The slots a day shows one dot for, in the order the dots are drawn. Snack has no dot.
export const CALENDAR_DOT_SLOTS: readonly HomeMealSlot[] = ['breakfast', 'lunch', 'dinner'];

// The row of slot dots under each day, and the space it adds to the row of days.
export const SLOT_DOT_SIZE = 5;
export const SLOT_DOT_GAP = 3;
export const SLOT_DOT_ROW_HEIGHT = 9;

export const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

// Indexed by `Date.getDay()`, as `WEEKDAYS`.
export const WEEKDAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];
