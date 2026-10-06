import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import type { HomeMealSummary } from '../domain/localMealPlan';
import type { HomeMetrics } from '../utils/responsive';
import { getTopLeftLabel } from './FoodCard/utils';

interface PendingDayCardProps {
  selectedDate: string;
  meals: HomeMealSummary[];
  metrics: HomeMetrics;
}

// Same direction and stops as the FoodCard gradient, expressed for a plain rectangle.
const GRADIENT_START = { x: 0.02, y: 0.48 };
const GRADIENT_END = { x: 0.8, y: 1.26 };
const GRADIENT_LOCATIONS = [0.38, 0.78] as const;

export function PendingDayCard({ selectedDate, meals, metrics }: PendingDayCardProps) {
  const { theme } = useRecipeTheme();
  const dayLabel = getTopLeftLabel(selectedDate);
  const borderRadius = metrics.pendingCardRadius;
  const { currentColors, previousColors, animatedStyle, AnimatedView } = useGradientCrossfade([
    theme.colorMedium,
    theme.colorDark,
  ]);
  const dayNameStyle = useAnimatedThemeStyle({ color: theme.textMedium });
  const dayNumberStyle = useAnimatedThemeStyle({ color: theme.primaryAccent });
  const mealNameStyle = useAnimatedThemeStyle({ color: theme.textLight });
  // Three meals only fit with one line each.
  const mealNameLines = meals.length > 2 ? 1 : 2;

  return (
    <ShadowSurface style={[styles.fill, { borderRadius }]}>
      <View style={[styles.fill, styles.surface, { borderRadius }]}>
        <LinearGradient
          colors={previousColors}
          start={GRADIENT_START}
          end={GRADIENT_END}
          locations={GRADIENT_LOCATIONS}
          style={StyleSheet.absoluteFill}
        />
        <AnimatedView style={[StyleSheet.absoluteFill, animatedStyle]}>
          <LinearGradient
            colors={currentColors}
            start={GRADIENT_START}
            end={GRADIENT_END}
            locations={GRADIENT_LOCATIONS}
            style={styles.fill}
          />
        </AnimatedView>
        <View
          style={[styles.content, { gap: metrics.rowGap, paddingVertical: metrics.sectionGap }]}>
          <View style={styles.dayLabel}>
            <Animated.Text
              style={[styles.dayName, { fontSize: metrics.foodCardLabelFontSize }, dayNameStyle]}>
              {dayLabel?.dayName}
            </Animated.Text>
            <Animated.Text
              style={[
                styles.dayNumber,
                { fontSize: metrics.foodCardNumberFontSize },
                dayNumberStyle,
              ]}>
              {dayLabel?.dayNumber}
            </Animated.Text>
          </View>
          <View style={[styles.meals, { gap: metrics.rowGap }]}>
            {meals.map((meal) => (
              <Animated.Text
                key={meal.id}
                numberOfLines={mealNameLines}
                style={[
                  styles.mealName,
                  {
                    fontSize: metrics.foodCardDescriptionFontSize,
                    lineHeight: metrics.foodCardDescriptionLineHeight,
                  },
                  mealNameStyle,
                ]}>
                {meal.name}
              </Animated.Text>
            ))}
          </View>
        </View>
      </View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 14,
  },
  dayLabel: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
  },
  dayName: {
    fontFamily: 'MontserratAlternates_700Bold',
    letterSpacing: 1,
  },
  dayNumber: {
    fontFamily: 'MontserratAlternates_900Black',
    letterSpacing: 1,
  },
  fill: {
    flex: 1,
    width: '100%',
  },
  mealName: {
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  meals: {
    flexShrink: 1,
    overflow: 'hidden',
  },
  surface: {
    overflow: 'hidden',
  },
});
