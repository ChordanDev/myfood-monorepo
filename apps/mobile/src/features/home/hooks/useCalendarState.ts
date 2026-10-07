import { useState, useMemo, useEffect } from 'react';
import {
  formatDateKey,
  startOfDay,
  formatMonthKey,
  parseMonthKey,
  getMonthGrid,
  parseDateKey,
} from '../utils/calendarDate';
import type { CalendarMonthBounds, PlanByDate } from '../types/calendar';
import { getAllowedMonthKeys, isSelectableMealDate } from '../domain/localMealPlan';

// Rules a caller can replace. Without them the calendar follows the meal plan.
type CalendarRules = {
  isDateSelectable?: (dateString: string) => boolean;
  monthBounds?: CalendarMonthBounds;
};

export function useCalendarState(
  planByDate: PlanByDate = {},
  selectedDate?: string | null,
  onSelectDate?: (dateString: string) => void,
  { isDateSelectable, monthBounds }: CalendarRules = {}
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

  // Open-ended bounds: every month from this one on. Otherwise the months are a closed list.
  const firstMonthKey = monthBounds && 'from' in monthBounds ? monthBounds.from : null;
  const listedMonthKeys = monthBounds && 'months' in monthBounds ? monthBounds.months : null;

  const allowedMonthKeys = useMemo(() => {
    return listedMonthKeys ?? getAllowedMonthKeys(planByDate);
  }, [listedMonthKeys, planByDate]);

  const currentMonthIndex = allowedMonthKeys.indexOf(currentMonthKey);
  const hasAllowedMonths = allowedMonthKeys.length > 0;
  const isPrevDisabled =
    firstMonthKey !== null
      ? currentMonthKey <= firstMonthKey
      : hasAllowedMonths
        ? currentMonthIndex <= 0
        : false;
  const isNextDisabled =
    firstMonthKey !== null
      ? false
      : hasAllowedMonths
        ? currentMonthIndex >= allowedMonthKeys.length - 1
        : false;

  // Where to move when the displayed month is outside the bounds: their first month.
  const outOfBoundsMonthKey =
    firstMonthKey !== null
      ? currentMonthKey < firstMonthKey
        ? firstMonthKey
        : null
      : hasAllowedMonths && currentMonthIndex === -1
        ? allowedMonthKeys[0]
        : null;

  useEffect(() => {
    if (outOfBoundsMonthKey !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Aligns the displayed month with the available months.
      setCurrentMonth(parseMonthKey(outOfBoundsMonthKey));
    }
  }, [outOfBoundsMonthKey]);

  const monthGrid = useMemo(() => getMonthGrid(year, month), [year, month]);

  const handlePrevMonth = () => {
    if (firstMonthKey !== null) {
      if (currentMonthKey > firstMonthKey) {
        setCurrentMonth(new Date(year, month - 1, 1));
      }
      return;
    }

    if (!hasAllowedMonths || currentMonthIndex <= 0) {
      return;
    }
    setCurrentMonth(parseMonthKey(allowedMonthKeys[currentMonthIndex - 1]));
  };

  const handleNextMonth = () => {
    if (firstMonthKey !== null) {
      setCurrentMonth(new Date(year, month + 1, 1));
      return;
    }

    if (
      !hasAllowedMonths ||
      currentMonthIndex === -1 ||
      currentMonthIndex >= allowedMonthKeys.length - 1
    ) {
      return;
    }
    setCurrentMonth(parseMonthKey(allowedMonthKeys[currentMonthIndex + 1]));
  };

  const canSelectDate = (dateString: string) => {
    return isDateSelectable
      ? isDateSelectable(dateString)
      : isSelectableMealDate(dateString, planByDate, today, parseDateKey);
  };

  const handleSelectDate = (dateString: string) => {
    if (!canSelectDate(dateString)) {
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
    canSelectDate,
  };
}
