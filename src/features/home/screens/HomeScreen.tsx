import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { AddCircleButton, NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { Calendar, FloatingFoodImage, FoodTypeSwitcher } from '../components';
import type { MealType as CalendarMealType } from '../types/calendar';
import { FoodCard } from '../components/FoodCard';
import { useHomeResponsiveScale } from '../hooks/useHomeResponsiveScale';
import { useHomeState } from '../hooks/useHomeState';
import { GRADIENTS } from '@/constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useEffect, useMemo } from 'react';

const DEFAULT_FOOD_IMAGE = require('../../../../assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png');

export function HomeScreen() {
  const router = useRouter();
  const metrics = useHomeResponsiveScale();
  const insets = useSafeAreaInsets();
  const tabBarHeight = insets.bottom + 60;
  const { theme, setRecipeTheme } = useRecipeTheme();

  // Logica de negocio extraida a un hook dedicado que ahora usa Zustand.
  const {
    selectedDate,
    selectedMealType,
    availableMealTypes,
    selectedMeal,
    planByDate,
    handleSelectDate,
    handleMealTypeChange,
  } = useHomeState();

  // Actualizar el tema global cuando cambia la comida seleccionada con un pequeño delay para estabilidad
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedMeal?.theme) {
        setRecipeTheme(selectedMeal.theme);
      } else {
        setRecipeTheme(null);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedMeal?.recipeId, setRecipeTheme]);

  const selectedMealDescription = selectedMeal?.descripcion ?? '';
  const foodImageSource = selectedMeal?.imageUrl
    ? { uri: selectedMeal.imageUrl }
    : DEFAULT_FOOD_IMAGE;

  const handlePressSparkles = () => {
    if (selectedMeal?.recipeId) {
      router.push(`/recipe/${selectedMeal.recipeId}`);
    }
  };

  const bgColors = useMemo(() => {
    if (!theme?.appBgGradient || theme.appBgGradient.length < 2) {
      return [...GRADIENTS.home.colors] as string[];
    }
    return [...theme.appBgGradient] as string[];
  }, [theme?.appBgGradient]);

  return (
    <LinearGradient
      colors={bgColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent includeBottom={false} style={{ flex: 1 }}>
        <TitlePrimary text="COMIDAS" metrics={metrics} />
        <View
          className="w-full flex-1"
          style={{
            paddingHorizontal: metrics.horizontalPadding,
            paddingBottom: metrics.bottomPadding + tabBarHeight,
            gap: metrics.sectionGap,
          }}>
          <View className="h-3/6 flex-shrink" style={{ gap: metrics.rowGap }}>
            <View className="relative flex-1 flex-row items-start" style={{ gap: metrics.rowGap }}>
              <FloatingFoodImage
                source={foodImageSource}
                leftPercent={metrics.foodImageLeftPercent}
                topPercent={metrics.foodImageTopPercent}
                widthPercent={metrics.foodImageWidthPercent}
                sizeScale={metrics.foodImageSizeScale}
              />
              <View style={{ width: `${metrics.cardColumnPercent}%` }}>
                <FoodCard
                  mealType={selectedMealType}
                  description={selectedMealDescription}
                  selectedDate={selectedDate}
                  metrics={metrics}
                  onPressSparkles={handlePressSparkles}
                />
              </View>
              <View
                className="items-start self-end"
                style={{ width: `${metrics.sideColumnPercent}%` }}>
                <AddCircleButton
                  size={metrics.addButtonSize}
                  onPress={() => router.push('/planner')}
                />
              </View>
            </View>
            <View className="min-w-full">
              <FoodTypeSwitcher
                value={selectedMealType === 'snack' ? null : selectedMealType}
                availableTypes={availableMealTypes as unknown as CalendarMealType[]}
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
