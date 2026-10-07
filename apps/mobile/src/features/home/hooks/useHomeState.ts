import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { formatDateKey, isPendingDate, parseDateKey } from '../utils/calendarDate';
import { useMealPlanStore } from '@/store';
import {
  buildLocalMealPlanByDate,
  getAvailableHomeMealTypes,
  getDefaultHomeMealType,
  getHomeMealSummaries,
  getInitialSelectedDate,
  getPendingConfirmationEntries,
  getPendingHomeMealType,
  getSelectedLocalMeal,
} from '../domain/localMealPlan';
import type { HomeMealType } from '../domain/localMealPlan';

export function useHomeState() {
  const entries = useMealPlanStore((state) => state.entries);
  const recipes = useMealPlanStore((state) => state.recipes);
  const todayKey = formatDateKey(new Date());
  const today = useMemo(() => parseDateKey(todayKey), [todayKey]);

  const planByDate = useMemo(() => {
    return buildLocalMealPlanByDate(entries);
  }, [entries]);

  // Past days never take the default selection: a pending one is only opened by the user.
  const upcomingDateKeys = useMemo(
    () => Object.keys(planByDate).filter((dateKey) => parseDateKey(dateKey) >= today),
    [planByDate, today]
  );

  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getInitialSelectedDate(upcomingDateKeys, todayKey)
  );
  const [selectedMealType, setSelectedMealType] = useState<HomeMealType | null>(null);

  useEffect(() => {
    if (selectedDate === null && upcomingDateKeys.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initializes selection when meal-plan dates become available.
      setSelectedDate(getInitialSelectedDate(upcomingDateKeys, todayKey));
    }
  }, [upcomingDateKeys, selectedDate, todayKey]);

  const mealsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return planByDate[selectedDate] ?? [];
  }, [planByDate, selectedDate]);

  const isPendingConfirmationDay =
    selectedDate !== null && isPendingDate(selectedDate, planByDate, today);

  // A past day is only worth showing while it has a meal to confirm.
  const isSettledPastDay =
    selectedDate !== null && !isPendingConfirmationDay && parseDateKey(selectedDate) < today;

  useLayoutEffect(() => {
    if (!isSettledPastDay) return;

    const nextDate = getInitialSelectedDate(upcomingDateKeys, todayKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Leaves a past day once its last meal is confirmed, before it is painted as a regular day.
    setSelectedDate(nextDate);
    setSelectedMealType(getDefaultHomeMealType(planByDate[nextDate] ?? [], new Date()));
  }, [isSettledPastDay, planByDate, todayKey, upcomingDateKeys]);

  // On a pending day only the meals that still need a confirmation can be picked.
  const availableMealTypes = useMemo(
    () =>
      getAvailableHomeMealTypes(
        isPendingConfirmationDay
          ? getPendingConfirmationEntries(mealsForSelectedDate)
          : mealsForSelectedDate
      ),
    [isPendingConfirmationDay, mealsForSelectedDate]
  );

  useEffect(() => {
    if (!selectedMealType || !availableMealTypes.includes(selectedMealType)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Keeps the selected meal type valid for the selected date.
      setSelectedMealType(
        isPendingConfirmationDay
          ? getPendingHomeMealType(mealsForSelectedDate)
          : getDefaultHomeMealType(mealsForSelectedDate, new Date())
      );
    }
  }, [
    availableMealTypes,
    isPendingConfirmationDay,
    mealsForSelectedDate,
    selectedDate,
    selectedMealType,
  ]);

  const selectedMeal = useMemo(() => {
    return getSelectedLocalMeal(mealsForSelectedDate, recipes, selectedMealType);
  }, [mealsForSelectedDate, recipes, selectedMealType]);

  const selectedDayMeals = useMemo(
    () => getHomeMealSummaries(mealsForSelectedDate, recipes),
    [mealsForSelectedDate, recipes]
  );

  const handleSelectDate = (dateString: string, mealType?: HomeMealType) => {
    setSelectedDate(dateString);

    // Opening a pending day starts on its first unconfirmed meal instead of keeping the previous meal type.
    const opensPendingDay =
      dateString !== selectedDate && isPendingDate(dateString, planByDate, today);
    const nextMealType =
      mealType ?? (opensPendingDay ? getPendingHomeMealType(planByDate[dateString] ?? []) : null);

    if (nextMealType) {
      setSelectedMealType(nextMealType);
    }
  };

  const handleMealTypeChange = (mealType: HomeMealType) => {
    if (!availableMealTypes.includes(mealType)) return;
    setSelectedMealType(mealType);
  };

  return {
    selectedDate,
    selectedMealType,
    availableMealTypes,
    selectedMeal,
    selectedDayMeals,
    isPendingConfirmationDay,
    planByDate,
    handleSelectDate,
    handleMealTypeChange,
  };
}
