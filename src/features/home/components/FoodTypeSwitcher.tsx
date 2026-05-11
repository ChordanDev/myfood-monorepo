import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  withSequence,
} from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import type { MealType } from '@/mocks';
import type { HomeMetrics } from '../utils/responsive';

interface FoodTypeSwitcherProps {
  value: MealType | null;
  availableTypes?: MealType[];
  onChange?: (mealType: MealType) => void;
  metrics: HomeMetrics;
}

const ORDERED_MEAL_TYPES: MealType[] = ['desayuno', 'almuerzo', 'cena'];

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
};

interface SwitcherItemProps {
  mealType: MealType;
  isActive: boolean;
  isUnavailable: boolean;
  onPress: () => void;
  metrics: HomeMetrics;
}

const SwitcherItem = ({
  mealType,
  isActive,
  isUnavailable,
  onPress,
  metrics,
}: SwitcherItemProps) => {
  const width = useSharedValue(isActive ? 100 : 30);
  const opacity = useSharedValue(isActive ? 1 : 0);
  const textScale = useSharedValue(1);

  useEffect(() => {
    if (isActive) {
      // Fondo: Aparece suavemente de círculo a píldora
      opacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) });
      width.value = withTiming(100, { duration: 300, easing: Easing.out(Easing.quad) });

      // Texto: Pequeño pop bounce
      textScale.value = 0.8;
      textScale.value = withSequence(
        withTiming(1.1, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) })
      );
    } else {
      // Desaparece y vuelve a forma circular
      opacity.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) });
      width.value = withTiming(30, { duration: 250, easing: Easing.in(Easing.quad) });
      textScale.value = withTiming(1, { duration: 200 });
    }
  }, [isActive, width, opacity, textScale]);

  const animatedBackgroundStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
    opacity: opacity.value,
  }));

  const animatedTextStyle = useAnimatedStyle(() => ({
    transform: [{ scale: textScale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={isUnavailable}
      className="flex-1 items-center justify-center rounded-3xl"
      accessibilityState={{ disabled: isUnavailable, selected: isActive }}
      style={{
        opacity: isUnavailable && !isActive ? 0.35 : 1,
        paddingVertical: metrics.switcherItemPaddingVertical,
        paddingHorizontal: metrics.switcherPadding,
      }}>
      <View style={StyleSheet.absoluteFill} className="items-center justify-center">
        <Animated.View style={[styles.indicatorBackground, animatedBackgroundStyle]} />
      </View>
      <Animated.Text
        className="font-inter-semibold"
        style={[
          animatedTextStyle,
          {
            color: isActive ? '#D8D98B' : isUnavailable ? '#F6F2E8' : '#F5F3D4',
            fontSize: metrics.switcherFontSize,
            zIndex: 1,
          },
        ]}>
        {MEAL_TYPE_LABEL[mealType]}
      </Animated.Text>
    </Pressable>
  );
};

export function FoodTypeSwitcher({
  value,
  availableTypes = [],
  onChange,
  metrics,
}: FoodTypeSwitcherProps) {
  const availableTypesSet = new Set(availableTypes);

  return (
    <ShadowSurface
      className="flex-row rounded-3xl bg-[#1B210E]"
      style={{ padding: metrics.switcherPadding, borderRadius: metrics.switcherRadius }}>
      {ORDERED_MEAL_TYPES.map((mealType) => {
        const isActive = value === mealType;
        const isUnavailable = !availableTypesSet.has(mealType);

        return (
          <SwitcherItem
            key={mealType}
            mealType={mealType}
            isActive={isActive}
            isUnavailable={isUnavailable}
            onPress={() => onChange?.(mealType)}
            metrics={metrics}
          />
        );
      })}
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  indicatorBackground: {
    height: '100%',
    backgroundColor: 'rgba(216, 217, 139, 0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(216, 217, 139, 0.3)',
  },
});
