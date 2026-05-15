import { parseDateKey, startOfDay } from '../../utils/calendarDate';

export const SPANISH_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
});

export function getTopLeftLabel(selectedDate: string | null) {
  if (!selectedDate) {
    return null;
  }

  const selectedDay = startOfDay(parseDateKey(selectedDate));
  const today = startOfDay(new Date());

  if (selectedDay.getTime() === today.getTime()) {
    return { dayName: 'HOY', dayNumber: null, isToday: true };
  }

  const weekday = SPANISH_WEEKDAY_FORMATTER.format(selectedDay);
  const weekdayLabel = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return { dayName: weekdayLabel, dayNumber: String(selectedDay.getDate()), isToday: false };
}
