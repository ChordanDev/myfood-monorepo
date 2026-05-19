import { useEffect, useMemo, useState } from 'react';
import { formatDateKey } from '../utils/calendarDate';
import { useMealPlanStore } from '@/store';
import { MealType } from '@/types/domain';

const ORDERED_MEAL_TYPES: MealType[] = ['desayuno', 'almuerzo', 'cena'];

const MEAL_TYPE_MINUTES: Record<MealType, number> = {
  desayuno: 8 * 60,
  almuerzo: 13 * 60,
  cena: 20 * 60,
  snack: 17 * 60,
};

function getInitialSelectedDate(availableDateKeys: string[]) {
  const todayKey = formatDateKey(new Date());

  if (availableDateKeys.includes(todayKey)) {
    return todayKey;
  }

  return availableDateKeys[0] ?? todayKey;
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

export function useHomeState() {
  const { entries, recipes } = useMealPlanStore();
  
  const planByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    entries.forEach((entry) => {
      if (!map[entry.date]) map[entry.date] = [];
      map[entry.date].push(entry);
    });
    return map;
  }, [entries]);

  const availableDateKeys = useMemo(() => Object.keys(planByDate), [planByDate]);

  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getInitialSelectedDate(availableDateKeys)
  );
  const [selectedMealType, setSelectedMealType] = useState<MealType | null>(null);

  useEffect(() => {
    if (selectedDate === null && availableDateKeys.length > 0) {
      setSelectedDate(getInitialSelectedDate(availableDateKeys));
    }
  }, [availableDateKeys, selectedDate]);

  const mealsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return planByDate[selectedDate] ?? [];
  }, [planByDate, selectedDate]);

  const availableMealTypes = useMemo(
    () => {
      const types = mealsForSelectedDate.map(m => m.type);
      return ORDERED_MEAL_TYPES.filter(t => types.includes(t));
    },
    [mealsForSelectedDate]
  );

  useEffect(() => {
    if (!selectedMealType || !availableMealTypes.includes(selectedMealType)) {
      setSelectedMealType(getClosestMealType(availableMealTypes, new Date()));
    }
  }, [availableMealTypes, selectedDate]);

  const selectedMealEntry = useMemo(() => {
    if (!selectedMealType) return null;
    return mealsForSelectedDate.find((meal) => meal.type === selectedMealType) ?? null;
  }, [mealsForSelectedDate, selectedMealType]);

  const selectedMeal = useMemo(() => {
    if (!selectedMealEntry) return null;
    const recipe = recipes.find(r => r.id === selectedMealEntry.recipeId);
    return {
      ...selectedMealEntry,
      descripcion: recipe?.description ?? 'Sin descripción',
      imageUrl: recipe?.imageUrl,
      recipeId: recipe?.id,
      theme: recipe?.theme,
    };
  }, [selectedMealEntry, recipes]);

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
    planByDate,
    handleSelectDate,
    handleMealTypeChange,
  };
}

