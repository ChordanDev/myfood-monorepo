import { useEffect, useMemo, useState } from 'react';
import type { MealPlan, MealType, PlanByDate } from '@/features/home/types/calendar';
import { formatDateKey } from '../utils/calendarDate';

const ORDERED_MEAL_TYPES: MealType[] = ['desayuno', 'almuerzo', 'cena'];

const MEAL_TYPE_MINUTES: Record<MealType, number> = {
  desayuno: 8 * 60,
  almuerzo: 13 * 60,
  cena: 20 * 60,
};

function getAvailableDateKeys(planByDate: PlanByDate) {
  return Object.keys(planByDate)
    .filter((dateKey) => Boolean(planByDate[dateKey]?.length))
    .sort();
}

function getInitialSelectedDate(planByDate: PlanByDate) {
  const todayKey = formatDateKey(new Date());

  if (planByDate[todayKey]?.length) {
    return todayKey;
  }

  return getAvailableDateKeys(planByDate)[0] ?? null;
}

function getAvailableMealTypes(meals: MealPlan[]) {
  const availableTypes = new Set<MealType>();

  meals.forEach((meal) => {
    availableTypes.add(meal.tipo);
  });

  return ORDERED_MEAL_TYPES.filter((mealType) => availableTypes.has(mealType));
}

function getClosestMealType(availableMealTypes: MealType[], now: Date) {
  if (!availableMealTypes.length) {
    return null;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return availableMealTypes.reduce((closestType, currentType) => {
    const currentDistance = Math.abs(MEAL_TYPE_MINUTES[currentType] - currentMinutes);
    const closestDistance = Math.abs(MEAL_TYPE_MINUTES[closestType] - currentMinutes);

    if (currentDistance < closestDistance) {
      return currentType;
    }

    return closestType;
  });
}

export function useHomeState(planByDate: PlanByDate) {
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getInitialSelectedDate(planByDate)
  );
  const [selectedMealType, setSelectedMealType] = useState<MealType | null>(null);

  const availableDateKeys = useMemo(() => getAvailableDateKeys(planByDate), [planByDate]);

  useEffect(() => {
    if (!selectedDate || !availableDateKeys.includes(selectedDate)) {
      setSelectedDate(getInitialSelectedDate(planByDate));
    }
  }, [availableDateKeys, planByDate, selectedDate]);

  const mealsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return planByDate[selectedDate] ?? [];
  }, [planByDate, selectedDate]);

  const availableMealTypes = useMemo(
    () => getAvailableMealTypes(mealsForSelectedDate),
    [mealsForSelectedDate]
  );

  useEffect(() => {
    setSelectedMealType(getClosestMealType(availableMealTypes, new Date()));
  }, [availableMealTypes, selectedDate]);

  const selectedMeal = useMemo(() => {
    if (!selectedMealType) return null;
    return mealsForSelectedDate.find((meal) => meal.tipo === selectedMealType) ?? null;
  }, [mealsForSelectedDate, selectedMealType]);

  const handleSelectDate = (dateString: string) => {
    setSelectedDate(dateString);
  };

  const handleMealTypeChange = (mealType: MealType) => {
    if (!availableMealTypes.includes(mealType)) return;
    setSelectedMealType(mealType);
  };

  return {
    selectedDate,
    selectedMealType,
    availableMealTypes,
    selectedMeal,
    handleSelectDate,
    handleMealTypeChange,
  };
}
