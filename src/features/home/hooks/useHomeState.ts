import { useEffect, useMemo, useState } from 'react';
import { formatDateKey } from '../utils/calendarDate';
import { useMealPlanStore } from '@/store';
import {
  buildLocalMealPlanByDate,
  getAvailableHomeMealTypes,
  getClosestHomeMealType,
  getInitialSelectedDate,
  getSelectedLocalMeal,
} from '../domain/localMealPlan';
import type { HomeMealType } from '../domain/localMealPlan';

export function useHomeState() {
  const { entries, recipes } = useMealPlanStore();
  const todayKey = formatDateKey(new Date());

  const planByDate = useMemo(() => {
    return buildLocalMealPlanByDate(entries);
  }, [entries]);

  const availableDateKeys = useMemo(() => Object.keys(planByDate), [planByDate]);

  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getInitialSelectedDate(availableDateKeys, todayKey)
  );
  const [selectedMealType, setSelectedMealType] = useState<HomeMealType | null>(null);

  useEffect(() => {
    if (selectedDate === null && availableDateKeys.length > 0) {
      setSelectedDate(getInitialSelectedDate(availableDateKeys, todayKey));
    }
  }, [availableDateKeys, selectedDate, todayKey]);

  const mealsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return planByDate[selectedDate] ?? [];
  }, [planByDate, selectedDate]);

  const availableMealTypes = useMemo(
    () => getAvailableHomeMealTypes(mealsForSelectedDate),
    [mealsForSelectedDate]
  );

  useEffect(() => {
    if (!selectedMealType || !availableMealTypes.includes(selectedMealType)) {
      setSelectedMealType(getClosestHomeMealType(availableMealTypes, new Date()));
    }
  }, [availableMealTypes, selectedDate, selectedMealType]);

  const selectedMeal = useMemo(() => {
    return getSelectedLocalMeal(mealsForSelectedDate, recipes, selectedMealType);
  }, [mealsForSelectedDate, recipes, selectedMealType]);

  const handleSelectDate = (dateString: string) => {
    setSelectedDate(dateString);
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
    planByDate,
    handleSelectDate,
    handleMealTypeChange,
  };
}
