import { useMemo } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AddCircleButton, NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { getMockPlanByDate } from '@/mocks';
import { Calendar, FloatingFoodImage, FoodTypeSwitcher } from '../components';
import { FoodCard } from '../components/FoodCard';
import { useHomeResponsiveScale } from '../hooks/useHomeResponsiveScale';
import { useHomeState } from '../hooks/useHomeState';
import { GRADIENTS } from '@/constants/theme';

const FOOD_CARD_IMAGE = require('../../../../assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png');

export function HomeScreen() {
  const metrics = useHomeResponsiveScale();
  // useMemo evita que planByDate sea una referencia nueva en cada render.
  const planByDate = useMemo(() => getMockPlanByDate(), []);
  
  // Logica de negocio extraida a un hook dedicado.
  const {
    selectedDate,
    selectedMealType,
    availableMealTypes,
    selectedMeal,
    handleSelectDate,
    handleMealTypeChange,
  } = useHomeState(planByDate);

  const selectedMealDescription = selectedMeal?.descripcion ?? '';

  return (
    <LinearGradient
      colors={[...GRADIENTS.home.colors]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[...GRADIENTS.home.locations]}
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
                <FoodCard
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
