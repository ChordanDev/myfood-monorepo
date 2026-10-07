import { useCallback, useMemo, useState } from 'react';
import { formatDateKey, selectRangeDate, type CalendarRange } from '@/features/home';
import { useMealPlanStore } from '@/store';
import {
  getDefaultPlanningRange,
  getPlannedDaysFrom,
  getPlanningMonthBounds,
  isPlannableDate,
} from '../domain/planningRange';

/**
 * The range of days the Planner is asked to plan, and what its calendar needs to pick it.
 * The range lives as long as the screen: it is not stored, and nothing but the pill reads it
 * yet.
 */
export function usePlanningRange() {
  const entries = useMealPlanStore((state) => state.entries);
  const todayKey = formatDateKey(new Date());
  const [range, setRange] = useState<CalendarRange>(() => getDefaultPlanningRange(todayKey));

  const planByDate = useMemo(() => getPlannedDaysFrom(entries, todayKey), [entries, todayKey]);
  const monthBounds = useMemo(() => getPlanningMonthBounds(todayKey), [todayKey]);
  const isDateSelectable = useCallback(
    (dateKey: string) => isPlannableDate(dateKey, todayKey),
    [todayKey]
  );

  // One tap of the range gesture. It returns the range the tap leaves, so the caller can tell
  // a finished range from one that still waits for its end.
  const selectDate = useCallback(
    (dateKey: string) => {
      const nextRange = selectRangeDate(range, dateKey);
      setRange(nextRange);

      return nextRange;
    },
    [range]
  );

  return { range, planByDate, isDateSelectable, monthBounds, selectDate };
}
