import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { useTitleMetrics } from '@/hooks/useTitleMetrics';
import {
  getMockMealDescription,
  getMockMealType,
  mockPlanByDate,
  type MockMealPlan,
  type MockMealType,
} from '@/mocks';
import { Calendar } from '../components/Calendar';
import { FoodTypeSwitcher } from '../components/FoodTypeSwitcher';
import HomeFoodCard from '../components/FoodCard';
import { formatDateKey } from '../utils/calendarDate';

const ORDERED_MEAL_TYPES: MockMealType[] = ['desayuno', 'almuerzo', 'cena'];

const MEAL_TYPE_MINUTES: Record<MockMealType, number> = {
  desayuno: 8 * 60,
  almuerzo: 13 * 60,
  cena: 20 * 60,
};

function getAvailableDateKeys(planByDate: Record<string, MockMealPlan[]>) {
  return Object.keys(planByDate)
    .filter((dateKey) => Boolean(planByDate[dateKey]?.length))
    .sort();
}

function getInitialSelectedDate(planByDate: Record<string, MockMealPlan[]>) {
  const todayKey = formatDateKey(new Date());

  if (planByDate[todayKey]?.length) {
    return todayKey;
  }

  return getAvailableDateKeys(planByDate)[0] ?? null;
}

function getAvailableMealTypes(meals: MockMealPlan[]) {
  const availableTypes = new Set<MockMealType>();

  meals.forEach((meal) => {
    availableTypes.add(getMockMealType(meal));
  });

  return ORDERED_MEAL_TYPES.filter((mealType) => availableTypes.has(mealType));
}

function getClosestMealType(availableMealTypes: MockMealType[], now: Date) {
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

export function HomeScreen() {
  const metrics = useTitleMetrics();
  const planByDate = mockPlanByDate;
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getInitialSelectedDate(planByDate)
  );
  const [selectedMealType, setSelectedMealType] = useState<MockMealType | null>(null);

  const availableDateKeys = useMemo(() => getAvailableDateKeys(planByDate), [planByDate]);

  useEffect(() => {
    if (!selectedDate || !availableDateKeys.includes(selectedDate)) {
      setSelectedDate(getInitialSelectedDate(planByDate));
    }
  }, [availableDateKeys, planByDate, selectedDate]);

  const mealsForSelectedDate = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

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
    if (!selectedMealType) {
      return null;
    }

    return mealsForSelectedDate.find((meal) => getMockMealType(meal) === selectedMealType) ?? null;
  }, [mealsForSelectedDate, selectedMealType]);

  const selectedMealDescription = selectedMeal ? getMockMealDescription(selectedMeal) : null;

  const handleSelectDate = (dateString: string) => {
    setSelectedDate(dateString);
  };

  const handleMealTypeChange = (mealType: MockMealType) => {
    if (!availableMealTypes.includes(mealType)) {
      return;
    }

    setSelectedMealType(mealType);
  };

  return (
    <LinearGradient
      colors={['#17180E', '#565A41', '#E5D8C4']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.05, 0.15]}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent includeBottom={false} style={{ flex: 1 }}>
        <TitlePrimary text="COMIDAS" metrics={metrics} />
        <View className="w-full flex-1 gap-4 px-4 pb-4">
          <View className="h-3/6 w-2/3 justify-between gap-4">
            <View className="flex-1">
              <HomeFoodCard mealType={selectedMealType} description={selectedMealDescription} />
            </View>
            <View>
              <FoodTypeSwitcher
                value={selectedMealType}
                availableTypes={availableMealTypes}
                onChange={handleMealTypeChange}
              />
            </View>
          </View>
          <View className="mt-auto h-3/6 w-full">
            <Calendar
              planByDate={planByDate}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              daySize={44}
              viewportHeight={320}
              minHeight={370}
            />
          </View>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
