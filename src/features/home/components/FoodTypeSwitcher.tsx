import { useEffect, useMemo, useState } from 'react';
import { Pressable, LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import type { HomeMealType } from '../domain/localMealPlan';
import type { HomeMetrics } from '../utils/responsive';

import { useThemeColor } from '@/hooks/useThemeColor';

interface FoodTypeSwitcherProps {
  value: MealType | null;
  availableTypes?: MealType[];
  onChange?: (mealType: MealType) => void;
  metrics: HomeMetrics;
}

type MealType = HomeMealType;

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
  onLayout: (event: LayoutChangeEvent) => void;
}

const SwitcherItem = ({
  mealType,
  isActive,
  isUnavailable,
  onPress,
  metrics,
  onLayout,
}: SwitcherItemProps) => {
  const { theme, getColorWithOpacity } = useThemeColor();
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      disabled={isUnavailable}
      className="flex-1 items-center justify-center rounded-3xl"
      accessibilityState={{ disabled: isUnavailable, selected: isActive }}
      style={{
        opacity: isUnavailable && !isActive ? 0.35 : 1,
        paddingVertical: metrics.switcherItemPaddingVertical,
        // Eliminamos el padding horizontal aquí para que el flex-1 distribuya el espacio real uniformemente
      }}>
      <Animated.Text
        className="font-inter-semibold"
        style={{
          color: isActive
            ? theme.textMedium
            : isUnavailable
              ? getColorWithOpacity('textLight', 0.44)
              : theme.textLight,
          fontSize: metrics.switcherFontSize,
          zIndex: 1,
        }}>
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
  const { theme, getColorWithOpacity } = useThemeColor();
  const indicatorBackgroundColor = useMemo(
    () => getColorWithOpacity('icon', 0.15),
    [getColorWithOpacity]
  );
  const indicatorBorderColor = useMemo(
    () => getColorWithOpacity('icon', 0.3),
    [getColorWithOpacity]
  );
  const availableTypesSet = new Set(availableTypes);
  const [layouts, setLayouts] = useState<
    Record<string, { x: number; width: number; height: number }>
  >({});

  const translateX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const indicatorHeight = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (value && layouts[value] && Object.keys(layouts).length === ORDERED_MEAL_TYPES.length) {
      const currentLayout = layouts[value];

      // Encontrar el ancho interno de la palabra más larga (Desayuno típicamente)
      // Como estamos usando flex-1 en los botones, su ancho total (width) ya es el mismo para todos
      // por lo tanto, el indicador solo tiene que medir exactamente lo mismo que el botón actual, o un poco menos para hacer de "píldora"

      // Queremos que la píldora sea un 90% del ancho del botón flex, centrada
      const pillWidth = currentLayout.width * 0.9;
      // Posición X = inicio del botón + la mitad del espacio restante
      const pillX = currentLayout.x + (currentLayout.width - pillWidth) / 2;

      translateX.value = withTiming(pillX, { duration: 300, easing: Easing.out(Easing.quad) });
      indicatorWidth.value = withTiming(pillWidth, {
        duration: 300,
        easing: Easing.out(Easing.quad),
      });
      indicatorHeight.value = withTiming(currentLayout.height, {
        duration: 300,
        easing: Easing.out(Easing.quad),
      });
      opacity.value = withTiming(1, { duration: 200 });
    } else if (!value) {
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [value, layouts, translateX, indicatorWidth, indicatorHeight, opacity]);

  const animatedIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: indicatorWidth.value,
    height: indicatorHeight.value,
    opacity: opacity.value,
    position: 'absolute',
    // Alineamos verticalmente respecto al padre considerando el padding general del contenedor
    top: metrics.switcherPadding,
    backgroundColor: indicatorBackgroundColor,
    borderColor: indicatorBorderColor,
    borderRadius: 20,
    borderWidth: 1,
  }));

  return (
    <ShadowSurface
      className="flex-row rounded-3xl"
      style={{
        padding: metrics.switcherPadding,
        borderRadius: metrics.switcherRadius,
        position: 'relative',
        backgroundColor: theme.colorDark, // ~5% opacity for subtle background
      }}>
      {/* Indicador animado posicionado de forma absoluta dentro del contenedor principal */}
      <Animated.View style={[animatedIndicatorStyle]} />

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
            onLayout={(e) => {
              const { x, width, height } = e.nativeEvent.layout;
              setLayouts((prev) => ({ ...prev, [mealType]: { x, width, height } }));
            }}
          />
        );
      })}
    </ShadowSurface>
  );
}
