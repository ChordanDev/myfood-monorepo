import { useMemo } from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import { ShadowSurface } from '@/components';
import type { MealSlot } from '@/types/domain';
import type { HomeMetrics } from '../../utils/responsive';

import { FOOD_CARD_SHAPE_PATH, FOOD_CARD_GRADIENT_ACTIVE_ID } from './constants';
import { getTopLeftLabel } from './utils';
import { FavoriteStarIcon, SparklesGradientIcon } from './icons';
import { useFoodCardLayout } from './useFoodCardLayout';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

interface FoodCardProps {
  mealType: MealSlot | null;
  description: string | null;
  selectedDate: string | null;
  metrics: HomeMetrics;
  isFavorite: boolean;
  onToggleFavorite?: () => void;
  onOpenRecipe?: () => void;
}

export function FoodCard({
  mealType,
  description,
  selectedDate,
  metrics,
  isFavorite,
  onToggleFavorite,
  onOpenRecipe,
}: FoodCardProps) {
  const hasMealData = Boolean(mealType || description?.trim());
  const descriptionText = description?.trim() ?? '';
  const { getColorWithOpacity, theme } = useThemeColor();

  const sparklesBackgroundColor = useMemo(
    () => getColorWithOpacity('icon', 0.15),
    [getColorWithOpacity]
  );
  const sparklesBorderColor = useMemo(
    () => getColorWithOpacity('icon', 0.3),
    [getColorWithOpacity]
  );

  const topLeftLabel = getTopLeftLabel(selectedDate);
  const layout = useFoodCardLayout(metrics);
  const dayNameColor = topLeftLabel?.isToday ? theme.primaryAccent : theme.textMedium;
  const sparklesButtonThemeStyle = useAnimatedThemeStyle({
    backgroundColor: sparklesBackgroundColor,
    borderColor: sparklesBorderColor,
  });
  const descriptionThemeStyle = useAnimatedThemeStyle({ color: theme.textLight });

  return (
    <ShadowSurface style={styles.fill}>
      <Pressable
        onPress={onOpenRecipe}
        disabled={!hasMealData}
        accessibilityRole="button"
        accessibilityLabel="Ver receta"
        style={[styles.fill, styles.relative]}>
        <Svg
          pointerEvents="none"
          width="100%"
          height="100%"
          viewBox="4 0 263 240"
          preserveAspectRatio="none"
          accessible={false}>
          <Defs>
            <SvgLinearGradient
              id={FOOD_CARD_GRADIENT_ACTIVE_ID}
              x1="9"
              y1="114.507"
              x2="213.5"
              y2="302.007"
              gradientUnits="userSpaceOnUse">
              <Stop offset="0.379808" stopColor={theme.colorMedium} />
              <Stop offset="0.778846" stopColor={theme.colorDark} />
            </SvgLinearGradient>
          </Defs>
          <Path d={FOOD_CARD_SHAPE_PATH} fill={`url(#${FOOD_CARD_GRADIENT_ACTIVE_ID})`} />
        </Svg>

        <View style={styles.content}>
          <Pressable
            onPress={onToggleFavorite}
            disabled={!hasMealData}
            style={[
              styles.iconButton,
              {
                right: '35%',
                top: '5%',
                width: layout.topIconBoxSize as any,
                height: layout.topIconBoxSize as any,
                opacity: hasMealData ? 1 : 0.3,
              },
            ]}>
            <FavoriteStarIcon isFilled={isFavorite} />
          </Pressable>

          <Pressable
            onPress={onOpenRecipe}
            disabled={!hasMealData}
            style={[
              styles.iconButton,
              {
                bottom: '8%',
                right: '8%',
                width: layout.bottomIconBoxSize as any,
                height: layout.bottomIconBoxSize as any,
                opacity: hasMealData ? 1 : 0.3,
              },
            ]}>
            <Animated.View
              style={[
                styles.iconCircle,
                {
                  borderWidth: 1,
                  borderRadius: 999,
                  width: layout.bottomIconSize * 1.6,
                  height: layout.bottomIconSize * 1.6,
                },
                sparklesButtonThemeStyle,
              ]}>
              <SparklesGradientIcon size={layout.bottomIconSize} />
            </Animated.View>
          </Pressable>

          <View
            style={[
              styles.absolute,
              {
                left: layout.dayLabelLeft as any,
                top: '20%',
                width: layout.dayLabelWidth as any,
              },
            ]}>
            {topLeftLabel ? (
              <Text style={styles.dayLabel}>
                <Text
                  adjustsFontSizeToFit
                  style={[
                    styles.dayName,
                    { color: dayNameColor, fontSize: metrics.foodCardLabelFontSize },
                  ]}>
                  {topLeftLabel.dayName}
                </Text>
                {topLeftLabel.dayNumber ? (
                  <Text
                    adjustsFontSizeToFit
                    style={[
                      styles.dayNumber,
                      {
                        color: theme.primaryAccent,
                        fontSize: metrics.foodCardNumberFontSize,
                      },
                    ]}>
                    {' '}
                    {topLeftLabel.dayNumber}
                  </Text>
                ) : null}
              </Text>
            ) : null}
          </View>
          <View
            style={[
              styles.absolute,
              {
                left: layout.descriptionLeft as any,
                top: '50%',
                width: layout.descriptionWidth as any,
              },
            ]}>
            <Animated.Text
              testID={descriptionText ? 'e2e-home-scheduled-meal' : undefined}
              style={[
                styles.description,
                {
                  fontSize: metrics.foodCardDescriptionFontSize as any,
                  lineHeight: metrics.foodCardDescriptionLineHeight as any,
                },
                descriptionThemeStyle,
              ]}
              numberOfLines={5}>
              {descriptionText}
            </Animated.Text>
          </View>
        </View>
      </Pressable>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  absolute: {
    position: 'absolute',
  },
  content: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 14,
    paddingTop: 10.5,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  dayLabel: {
    letterSpacing: 1,
    textAlign: 'center',
  },
  dayName: {
    fontFamily: 'MontserratAlternates_700Bold',
  },
  dayNumber: {
    fontFamily: 'MontserratAlternates_900Black',
  },
  description: {
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  fill: {
    height: '100%',
    width: '100%',
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  relative: {
    position: 'relative',
  },
});
