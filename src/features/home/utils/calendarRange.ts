// A range of days as the calendar shows it. Both ends are 'YYYY-MM-DD' keys, which sort like
// the dates they name, so they are compared as plain strings. `end` is missing while the user
// has only chosen the start.
export type CalendarRange = {
  start: string | null;
  end: string | null;
};

export const EMPTY_CALENDAR_RANGE: CalendarRange = { start: null, end: null };

export function isRangeComplete(range: CalendarRange) {
  return range.start !== null && range.end !== null;
}

export function isRangeEdge(dateKey: string, range: CalendarRange) {
  return dateKey === range.start || dateKey === range.end;
}

// Strictly between the two ends: the days the calendar tints instead of selecting.
export function isBetweenRangeEdges(dateKey: string, range: CalendarRange) {
  if (range.start === null || range.end === null) {
    return false;
  }

  return dateKey > range.start && dateKey < range.end;
}

export function isDateInRange(dateKey: string, range: CalendarRange) {
  return isRangeEdge(dateKey, range) || isBetweenRangeEdges(dateKey, range);
}

// The range after a tap on a day. The first tap sets the start; a second tap on that day or a
// later one sets the end; a tap before the start moves the start; a tap on a complete range
// starts a new one.
export function selectRangeDate(range: CalendarRange, tappedKey: string): CalendarRange {
  if (range.start === null || range.end !== null || tappedKey < range.start) {
    return { start: tappedKey, end: null };
  }

  return { start: range.start, end: tappedKey };
}
