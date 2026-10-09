import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDateKey, selectRangeDate, type CalendarRange } from '@/features/home';
import { useLoadLivePlan } from '@/features/home/hooks/useLoadLivePlan';
import { useMealPlanStore } from '@/store';
import {
  getFirstPlannableDate,
  getPlannedDaysFrom,
  getPlanningMonthBounds,
  isPlannableDate,
  resolvePlanningRange,
} from '../domain/planningRange';

/**
 * The range of days the Planner is asked to plan, and what its calendar needs to pick it.
 * The range lives as long as the screen: it is not stored, and nothing but the pill reads it
 * yet.
 */
export function usePlanningRange() {
  // The plan on screen is a cache of the calendar read: refresh it when the Planner opens.
  useLoadLivePlan();
  const entries = useMealPlanStore((state) => state.entries);
  const todayKey = formatDateKey(new Date());
  // What the user picked, if anything. The range in use is resolved from it on every render,
  // so it follows the plan: a default that moves with it, and a picked range that is dropped
  // once the plan reaches its start.
  const [pickedRange, setPickedRange] = useState<CalendarRange | null>(null);

  const firstPlannableDate = useMemo(
    () => getFirstPlannableDate(entries, todayKey),
    [entries, todayKey]
  );
  const range = useMemo(
    () => resolvePlanningRange(pickedRange, firstPlannableDate),
    [pickedRange, firstPlannableDate]
  );

  const planByDate = useMemo(() => getPlannedDaysFrom(entries, todayKey), [entries, todayKey]);
  const monthBounds = useMemo(
    () => getPlanningMonthBounds(firstPlannableDate),
    [firstPlannableDate]
  );
  const isDateSelectable = useCallback(
    (dateKey: string) => isPlannableDate(dateKey, firstPlannableDate),
    [firstPlannableDate]
  );

  // The range a tap starts from. A ref, not the rendered value: two taps can land before the
  // first one has re-rendered anything, and the second must still see the start it set.
  const currentRangeRef = useRef(range);

  useLayoutEffect(() => {
    currentRangeRef.current = range;
  }, [range]);

  // One tap of the range gesture. It returns the range the tap leaves, so the caller can tell
  // a finished range from one that still waits for its end.
  const selectDate = useCallback((dateKey: string) => {
    const nextRange = selectRangeDate(currentRangeRef.current, dateKey);
    currentRangeRef.current = nextRange;
    setPickedRange(nextRange);

    return nextRange;
  }, []);

  return { range, planByDate, isDateSelectable, monthBounds, selectDate };
}
