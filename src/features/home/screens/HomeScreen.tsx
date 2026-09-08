import { Alert, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { AddCircleButton, NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import {
  Calendar,
  EatTodayButton,
  EAT_TODAY_CUTOFF_MINUTES,
  EAT_TODAY_DESTINATION_TYPES,
  EAT_TODAY_LABEL,
  FloatingFoodImage,
  FoodTypeSwitcher,
} from '../components';
import { FoodCard } from '../components/FoodCard';
import { useHomeResponsiveScale } from '../hooks/useHomeResponsiveScale';
import { useHomeState } from '../hooks/useHomeState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHomeRecipeTheme } from '../hooks/useHomeRecipeTheme';
import { formatDateKey } from '../utils/calendarDate';
import { useMealPlanStore } from '@/store';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { getRecipeImageSource } from '@/features/recipe/utils/recipeImageSource';

const DEFAULT_FOOD_IMAGE = require('../../../../assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png');

export function HomeScreen() {
  const router = useRouter();
  const metrics = useHomeResponsiveScale();
  const insets = useSafeAreaInsets();
  const tabBarHeight = insets.bottom + 60;
  const eatToday = useMealPlanStore((state) => state.eatToday);

  const {
    selectedDate,
    selectedMealType,
    availableMealTypes,
    selectedMeal,
    planByDate,
    handleSelectDate,
    handleMealTypeChange,
  } = useHomeState();
  const theme = useHomeRecipeTheme(selectedMeal, selectedDate);
  const todayKey = formatDateKey(new Date());
  const isTodaySelected = selectedDate === todayKey;

  const selectedMealDescription = selectedMeal?.description ?? '';
  const foodImageSource = getRecipeImageSource(selectedMeal?.imageUrl) ?? DEFAULT_FOOD_IMAGE;
  const backgroundColors: [string, string] = [theme.colorDark, theme.appBg];
  const {
    currentColors: currentBackgroundColors,
    previousColors: previousBackgroundColors,
    animatedStyle: animatedBackgroundStyle,
    AnimatedView,
  } = useGradientCrossfade(backgroundColors);

  const handlePressSparkles = () => {
    if (selectedMeal?.recipeId) {
      router.push(`/recipe/${selectedMeal.recipeId}`);
    }
  };

  const getAvailableEatTodayDestinations = () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const todayEntries = planByDate[todayKey] ?? [];

    return EAT_TODAY_DESTINATION_TYPES.filter((mealType) => {
      const cutoffMinutes = EAT_TODAY_CUTOFF_MINUTES[mealType];
      const todayEntry = todayEntries.find((entry) => entry.type === mealType);

      return currentMinutes < cutoffMinutes && !todayEntry?.isCooked;
    });
  };

  const handleEatToday = () => {
    if (!selectedDate || !selectedMeal || !selectedMealType || isTodaySelected) {
      return;
    }

    const availableDestinations = getAvailableEatTodayDestinations();

    if (!availableDestinations.length) {
      Alert.alert(
        'No hay horarios disponibles',
        'El mediodía y la cena ya pasaron o sus comidas ya fueron marcadas como cocinadas.'
      );
      return;
    }

    Alert.alert(
      '¿Cuándo querés comerlo hoy?',
      'Elegí el horario para intercambiar o mover esta comida a hoy.',
      [
        ...availableDestinations.map((mealType) => ({
          text: EAT_TODAY_LABEL[mealType],
          onPress: () => {
            eatToday({
              sourceDate: selectedDate,
              sourceType: selectedMealType,
              targetDate: todayKey,
              targetType: mealType,
            });
            handleSelectDate(todayKey, mealType);
          },
        })),
        { text: 'Cancelar', style: 'cancel' as const },
      ]
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: backgroundColors[1] }]}>
      <LinearGradient
        colors={previousBackgroundColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        locations={[0, 0.1]}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedView style={[StyleSheet.absoluteFill, animatedBackgroundStyle]}>
        <LinearGradient
          colors={currentBackgroundColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          locations={[0, 0.1]}
          style={styles.gradient}
        />
      </AnimatedView>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent includeBottom={false} style={{ flex: 1 }}>
        <TitlePrimary text="COMIDAS" metrics={metrics} />
        <View
          style={[
            styles.content,
            {
              paddingHorizontal: metrics.horizontalPadding,
              paddingBottom: metrics.bottomPadding + tabBarHeight,
              gap: metrics.sectionGap,
            },
          ]}>
          <View style={[styles.topSection, { gap: metrics.rowGap }]}>
            <View style={[styles.mealRow, { gap: metrics.rowGap }]}>
              {isTodaySelected ? (
                <FloatingFoodImage
                  source={foodImageSource}
                  leftPercent={metrics.foodImageLeftPercent}
                  topPercent={metrics.foodImageTopPercent}
                  widthPercent={metrics.foodImageWidthPercent}
                  sizeScale={metrics.foodImageSizeScale}
                />
              ) : selectedMeal ? (
                <EatTodayButton
                  leftPercent={metrics.foodImageLeftPercent}
                  topPercent={metrics.foodImageTopPercent}
                  widthPercent={metrics.foodImageWidthPercent}
                  sizeScale={metrics.foodImageSizeScale}
                  backgroundColor={theme.primaryAccent}
                  textColor={theme.textBlack}
                  borderColor={theme.primaryAccentIntense}
                  onPress={handleEatToday}
                />
              ) : null}
              <View style={{ width: `${metrics.cardColumnPercent}%` }}>
                <FoodCard
                  mealType={selectedMealType}
                  description={selectedMealDescription}
                  selectedDate={selectedDate}
                  metrics={metrics}
                  onPressSparkles={handlePressSparkles}
                />
              </View>
              <View style={[styles.sideColumn, { width: `${metrics.sideColumnPercent}%` }]}>
                {isTodaySelected ? (
                  <AddCircleButton
                    size={metrics.addButtonSize}
                    onPress={() => router.push('/planner')}
                  />
                ) : null}
              </View>
            </View>
            <View style={styles.switcherRow}>
              <FoodTypeSwitcher
                value={selectedMealType}
                availableTypes={availableMealTypes}
                onChange={handleMealTypeChange}
                metrics={metrics}
              />
            </View>
          </View>
          <View style={styles.calendarSection}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  calendarSection: {
    height: '50%',
    marginTop: 'auto',
    width: '100%',
  },
  content: {
    flex: 1,
    width: '100%',
  },
  screen: { flex: 1 },
  gradient: { flex: 1 },
  mealRow: {
    alignItems: 'flex-start',
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  sideColumn: {
    alignItems: 'flex-start',
    alignSelf: 'flex-end',
  },
  switcherRow: {
    minWidth: '100%',
  },
  topSection: {
    flexShrink: 1,
    height: '50%',
  },
});
