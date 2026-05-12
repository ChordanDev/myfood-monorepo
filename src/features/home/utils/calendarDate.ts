import type { PlanByDate, MonthGridCell } from '../types/calendar';

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatMonthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function getMonthGrid(year: number, month: number): MonthGridCell[] {
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + totalDays) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - firstDay + 1;
    const cellDate = new Date(year, month, dayNumber);
    return {
      date: cellDate,
      isCurrentMonth: dayNumber > 0 && dayNumber <= totalDays,
    };
  });
}

export function getMonthDateKeys(year: number, month: number) {
  const totalDays = new Date(year, month + 1, 0).getDate();
  const keys: string[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    keys.push(formatDateKey(new Date(year, month, day)));
  }

  return keys;
}

export function isSelectableDate(dateString: string, planByDate: PlanByDate, today: Date) {
  const dayDate = parseDateKey(dateString);
  const isPast = dayDate < today;
  const isPlanned = Boolean(planByDate[dateString]?.length);
  return !isPast && isPlanned;
}
