import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AddCircleButton, NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import {
  getMockMealDescription,
  getMockMealType,
  mockPlanByDate,
  type MockMealPlan,
  type MockMealType,
} from '@/mocks';
import { Calendar, FloatingFoodImage, FoodTypeSwitcher } from '../components';
import HomeFoodCard from '../components/FoodCard';
import { useHomeResponsiveScale } from '../hooks/useHomeResponsiveScale';
import { formatDateKey } from '../utils/calendarDate';

const FOOD_CARD_IMAGE = require('../../../../assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png');

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
  const metrics = useHomeResponsiveScale();
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
      colors={['#17180E', '#565A41', '#D6C4B1']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.05, 0.15]}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent includeBottom={false} style={{ flex: 1 }}>
        <TitlePrimary text="COMIDAS" metrics={metrics} />
        <View
          className="w-full flex-1"
          style={{
            paddingHorizontal: metrics.horizontalPadding,
            paddingBottom: metrics.bottomPadding,
            gap: metrics.sectionGap,
          }}>
          <View className="h-3/6 flex-shrink" style={{ gap: metrics.rowGap }}>
            <View className="relative flex-1 flex-row items-start" style={{ gap: metrics.rowGap }}>
              <FloatingFoodImage
                source={FOOD_CARD_IMAGE}
                leftPercent={metrics.foodImageLeftPercent}
                topPercent={metrics.foodImageTopPercent}
                widthPercent={metrics.foodImageWidthPercent}
                sizeScale={metrics.foodImageSizeScale}
              />
              <View style={{ width: `${metrics.cardColumnPercent}%` }}>
                <HomeFoodCard
                  mealType={selectedMealType}
                  description={selectedMealDescription}
                  selectedDate={selectedDate}
                  metrics={metrics}
                />
              </View>
              <View
                className="items-start self-end"
                style={{ width: `${metrics.sideColumnPercent}%` }}>
                <AddCircleButton size={metrics.addButtonSize} />
              </View>
            </View>
            <View className="min-w-full">
              <FoodTypeSwitcher
                value={selectedMealType}
                availableTypes={availableMealTypes}
                onChange={handleMealTypeChange}
                metrics={metrics}
              />
            </View>
          </View>
          <View className="mt-auto h-3/6 w-full">
            <Calendar
              planByDate={planByDate}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              daySize={metrics.calendarDaySize}
              monthFontSize={metrics.calendarHeaderFontSize}
              navFontSize={metrics.calendarNavFontSize}
              weekdayFontSize={metrics.calendarWeekdayFontSize}
              dayFontSize={metrics.calendarDayFontSize}
            />
          </View>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
