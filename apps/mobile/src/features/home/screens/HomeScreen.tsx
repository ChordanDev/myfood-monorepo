import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { AddCircleButton, NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import {
  Calendar,
  CookedConfirmationCard,
  EatTodayButton,
  EatTodaySheet,
  FloatingFoodImage,
  FoodTypeSwitcher,
  PendingDayCard,
} from '../components';
import { FoodCard } from '../components/FoodCard';
import { getAvailableEatTodayDestinations, type EatTodayDestinationType } from '../domain/eatToday';
import { useHomeResponsiveScale } from '../hooks/useHomeResponsiveScale';
import { useEatToday } from '../hooks/useEatToday';
import { useHomeState } from '../hooks/useHomeState';
import { useLoadLivePlan } from '../hooks/useLoadLivePlan';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHomeRecipeTheme } from '../hooks/useHomeRecipeTheme';
import { formatDateKey } from '../utils/calendarDate';
import { CookingResultSheet, useMarkAsCooked } from '@/features/cooking';
import { useMealPlanStore } from '@/store';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { favoriteSummaryFromRecipe } from '@/features/favorites/domain/favoriteFormat';
import { selectIsFavorite, useFavoritesStore } from '@/features/favorites/store';
import { getRecipeImageSource } from '@/features/recipe/utils/recipeImageSource';

const DEFAULT_FOOD_IMAGE = require('../../../../assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png');

export function HomeScreen() {
  const router = useRouter();
  const metrics = useHomeResponsiveScale();
  const insets = useSafeAreaInsets();
  const tabBarHeight = insets.bottom + 60;
  const eatToday = useEatToday();
  useLoadLivePlan();
  const recipeSummaries = useMealPlanStore((state) => state.recipeSummaries);
  const cooking = useMarkAsCooked();
  const markAsSkipped = useMealPlanStore((state) => state.markAsSkipped);
  // Destinations are captured when the sheet opens so the options cannot change while it is shown.
  const [eatTodaySheet, setEatTodaySheet] = useState<{
    visible: boolean;
    destinations: EatTodayDestinationType[];
  }>({ visible: false, destinations: [] });

  const {
    selectedDate,
    selectedMealType,
    availableMealTypes,
    selectedMeal,
    selectedDayMeals,
    isPendingConfirmationDay,
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

  const selectedRecipeId = selectedMeal?.recipeId;
  // The favorites are the server's, the same ones the recipe screen reads.
  const isSelectedMealFavorite = useFavoritesStore(selectIsFavorite(selectedRecipeId ?? ''));

  const handleToggleFavorite = () => {
    if (!selectedRecipeId) return;

    // The plan does not carry the recipe's duration or ingredient names: the row is drawn
    // bare until the server answers with its own.
    void useFavoritesStore.getState().toggle(
      favoriteSummaryFromRecipe({
        id: selectedRecipeId,
        name: recipeSummaries[selectedRecipeId]?.name ?? '',
        durationMinutes: null,
        ingredients: [],
      })
    );
  };

  const handleOpenRecipe = () => {
    if (selectedMeal?.recipeId) {
      router.push({
        pathname: '/recipe/[id]',
        params: { id: selectedMeal.recipeId, entryId: selectedMeal.id },
      });
    }
  };

  const handleConfirmCooked = () => {
    if (selectedMeal) {
      void cooking.markAsCooked(selectedMeal.id);
    }
  };

  const handleConfirmSkipped = () => {
    if (selectedMeal) {
      markAsSkipped(selectedMeal.id);
    }
  };

  const handleEatToday = () => {
    if (!selectedDate || !selectedMeal || !selectedMealType || isTodaySelected) {
      return;
    }

    setEatTodaySheet({
      visible: true,
      destinations: getAvailableEatTodayDestinations(planByDate[todayKey] ?? [], new Date()),
    });
  };

  // Keeps the destinations so the content does not switch while the sheet fades out.
  const handleCloseEatTodaySheet = () => {
    setEatTodaySheet((current) => ({ ...current, visible: false }));
  };

  const handleSelectEatTodayDestination = async (mealType: EatTodayDestinationType) => {
    handleCloseEatTodaySheet();

    if (!selectedDate || !selectedMealType) {
      return;
    }

    const moved = await eatToday({
      sourceDate: selectedDate,
      sourceType: selectedMealType,
      targetDate: todayKey,
      targetType: mealType,
    });

    if (moved) {
      handleSelectDate(todayKey, mealType);
    }
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
            {/* Distinct keys remount the row: reusing the meal row's views kept its percent column width. */}
            {isPendingConfirmationDay && selectedDate ? (
              <View key="pending-row" style={[styles.pendingRow, { gap: metrics.rowGap }]}>
                <View style={styles.pendingDayColumn}>
                  <PendingDayCard
                    selectedDate={selectedDate}
                    meals={selectedDayMeals}
                    metrics={metrics}
                  />
                </View>
                <View style={styles.confirmationColumn}>
                  <CookedConfirmationCard
                    metrics={metrics}
                    onConfirmCooked={handleConfirmCooked}
                    onConfirmSkipped={handleConfirmSkipped}
                  />
                </View>
              </View>
            ) : (
              <View key="meal-row" style={[styles.mealRow, { gap: metrics.rowGap }]}>
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
                    isFavorite={isSelectedMealFavorite}
                    onToggleFavorite={handleToggleFavorite}
                    onOpenRecipe={handleOpenRecipe}
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
            )}
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
      <CookingResultSheet
        summary={cooking.summary}
        errorMessage={cooking.errorMessage}
        onClose={cooking.dismiss}
      />
      <EatTodaySheet
        visible={eatTodaySheet.visible}
        destinations={eatTodaySheet.destinations}
        onSelect={handleSelectEatTodayDestination}
        onClose={handleCloseEatTodaySheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  calendarSection: {
    height: '50%',
    marginTop: 'auto',
    width: '100%',
  },
  // Reference proportions: the day card is slightly wider than the confirmation card.
  confirmationColumn: {
    flex: 6,
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
  pendingDayColumn: {
    flex: 7,
  },
  pendingRow: {
    flex: 1,
    flexDirection: 'row',
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
