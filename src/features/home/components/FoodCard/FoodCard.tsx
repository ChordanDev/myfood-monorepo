import { useState } from 'react';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import { ShadowSurface } from '@/components';
import type { MealType } from '@/types/domain';
import type { HomeMetrics } from '../../utils/responsive';

import {
  FOOD_CARD_SHAPE_PATH,
  FOOD_CARD_GRADIENT_ACTIVE_ID,
  FOOD_CARD_GRADIENT_EMPTY_ID,
} from './constants';
import { getTopLeftLabel } from './utils';
import { FavoriteStarIcon, SparklesGradientIcon } from './icons';
import { useFoodCardLayout } from './useFoodCardLayout';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface FoodCardProps {
  mealType: MealType | null;
  description: string | null;
  selectedDate: string | null;
  metrics: HomeMetrics;
  onPressSparkles?: () => void;
}

export function FoodCard({
  mealType,
  description,
  selectedDate,
  metrics,
  onPressSparkles,
}: FoodCardProps) {
  const { theme } = useRecipeTheme();
  const [isFavorite, setIsFavorite] = useState(false);
  const hasMealData = Boolean(mealType || description?.trim());
  const descriptionText = description?.trim() ?? '';

  const topLeftLabel = getTopLeftLabel(selectedDate);
  const layout = useFoodCardLayout(metrics);
  const dayNameColor = topLeftLabel?.isToday ? '#FFB63C' : theme.primaryAccent;

  const stopColors = hasMealData
    ? [theme?.foodCardGradient?.[0] || '#364025', theme?.foodCardGradient?.[1] || '#1B210E']
    : ['#2F3D22', '#1B210E'];

  return (
    <ShadowSurface className="h-full w-full">
      <View className="relative h-full w-full">
        <Svg
          pointerEvents="none"
          width="100%"
          height="100%"
          viewBox="4 0 263 240"
          preserveAspectRatio="none"
          accessible={false}>
          <Defs>
            <SvgLinearGradient
              id="foodCardMainGradient"
              x1="9"
              y1="114.507"
              x2="213.5"
              y2="302.007"
              gradientUnits="userSpaceOnUse">
              <Stop offset="0.379808" stopColor={stopColors[0]} />
              <Stop offset="0.778846" stopColor={stopColors[1]} />
            </SvgLinearGradient>
          </Defs>
          <Path d={FOOD_CARD_SHAPE_PATH} fill="url(#foodCardMainGradient)" />
        </Svg>

        <View className="absolute inset-0 px-4 pt-3">
          <Pressable
            onPress={() => setIsFavorite((prev) => !prev)}
            className="absolute items-center justify-center"
            style={{
              right: '35%',
              top: '5%',
              width: layout.topIconBoxSize as any,
              height: layout.topIconBoxSize as any,
            }}>
            <FavoriteStarIcon isFilled={isFavorite} />
          </Pressable>

          <Pressable
            onPress={onPressSparkles}
            disabled={!hasMealData}
            className="absolute items-center justify-center"
            style={{
              bottom: '8%',
              right: '8%',
              width: layout.bottomIconBoxSize as any,
              height: layout.bottomIconBoxSize as any,
              opacity: hasMealData ? 1 : 0.3,
            }}>
            <View
              className="items-center justify-center"
              style={[
                styles.capsuleContainer,
                {
                  width: layout.bottomIconSize * 1.6,
                  height: layout.bottomIconSize * 1.6,
                },
              ]}>
              <SparklesGradientIcon size={layout.bottomIconSize} />
            </View>
          </Pressable>

          <View
            className="absolute"
            style={{
              left: layout.dayLabelLeft as any,
              top: '20%',
              width: layout.dayLabelWidth as any,
            }}>
            {topLeftLabel ? (
              <Text className="text-center" style={{ letterSpacing: 1 }}>
                <Text
                  adjustsFontSizeToFit
                  className="font-montserrat-alt-bold"
                  style={{ color: dayNameColor, fontSize: metrics.foodCardLabelFontSize }}>
                  {topLeftLabel.dayName}
                </Text>
                {topLeftLabel.dayNumber ? (
                  <Text
                    adjustsFontSizeToFit
                    className="font-montserrat-alt-black text-[#FFB63C]"
                    style={{ fontSize: metrics.foodCardNumberFontSize }}>
                    {' '}
                    {topLeftLabel.dayNumber}
                  </Text>
                ) : null}
              </Text>
            ) : null}
          </View>
          <View
            className="absolute"
            style={{
              left: layout.descriptionLeft as any,
              top: '50%',
              width: layout.descriptionWidth as any,
            }}>
            <Text
              className="text-center font-inter-medium"
              style={{
                color: theme.textMain,
                fontSize: metrics.foodCardDescriptionFontSize as any,
                lineHeight: metrics.foodCardDescriptionLineHeight as any,
              }}
              numberOfLines={5}>
              {descriptionText}
            </Text>
          </View>
        </View>
      </View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  capsuleContainer: {
    backgroundColor: 'rgba(216, 217, 139, 0.07)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(216, 217, 139, 0.15)',
  },
});
