import { useState, useMemo, useEffect } from 'react';
import {
  formatDateKey,
  isSelectableDate,
  startOfDay,
  formatMonthKey,
  parseMonthKey,
  getMonthGrid,
} from '../utils/calendarDate';
import type { PlanByDate } from '../types/calendar';

export function useCalendarState(
  planByDate: PlanByDate = {},
  selectedDate?: string | null,
  onSelectDate?: (dateString: string) => void
) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [internalSelectedDate, setInternalSelectedDate] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const todayKey = formatDateKey(today);
  const activeSelectedDate = selectedDate === undefined ? internalSelectedDate : selectedDate;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const currentMonthKey = formatMonthKey(year, month);

  const allowedMonthKeys = useMemo(() => {
    const keys = Object.keys(planByDate)
      .filter((dateKey) => Boolean(planByDate[dateKey]?.length))
      .map((dateKey) => dateKey.slice(0, 7));

    return Array.from(new Set(keys)).sort();
  }, [planByDate]);

  const currentMonthIndex = allowedMonthKeys.indexOf(currentMonthKey);
  const hasAllowedMonths = allowedMonthKeys.length > 0;
  const isPrevDisabled = hasAllowedMonths ? currentMonthIndex <= 0 : false;
  const isNextDisabled = hasAllowedMonths ? currentMonthIndex >= allowedMonthKeys.length - 1 : false;

  useEffect(() => {
    if (!hasAllowedMonths) {
      return;
    }

    if (currentMonthIndex === -1) {
      setCurrentMonth(parseMonthKey(allowedMonthKeys[0]));
    }
  }, [allowedMonthKeys, currentMonthIndex, hasAllowedMonths]);

  const monthGrid = useMemo(() => getMonthGrid(year, month), [year, month]);

  const handlePrevMonth = () => {
    if (!hasAllowedMonths || currentMonthIndex <= 0) {
      return;
    }
    setCurrentMonth(parseMonthKey(allowedMonthKeys[currentMonthIndex - 1]));
  };

  const handleNextMonth = () => {
    if (
      !hasAllowedMonths ||
      currentMonthIndex === -1 ||
      currentMonthIndex >= allowedMonthKeys.length - 1
    ) {
      return;
    }
    setCurrentMonth(parseMonthKey(allowedMonthKeys[currentMonthIndex + 1]));
  };

  const handleSelectDate = (dateString: string) => {
    if (!isSelectableDate(dateString, planByDate, today)) {
      return;
    }

    onSelectDate?.(dateString);
    if (selectedDate === undefined) {
      setInternalSelectedDate(dateString);
    }
  };

  return {
    year,
    month,
    today,
    todayKey,
    activeSelectedDate,
    monthGrid,
    isPrevDisabled,
    isNextDisabled,
    handlePrevMonth,
    handleNextMonth,
    handleSelectDate,
  };
}
