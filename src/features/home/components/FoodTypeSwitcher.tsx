import { Pressable, Text } from 'react-native';
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
          <Pressable
            key={mealType}
            onPress={() => onChange?.(mealType)}
            disabled={isUnavailable}
            className="flex-1 items-center rounded-3xl"
            accessibilityState={{ disabled: isUnavailable, selected: isActive }}
            style={{
              backgroundColor: isActive ? '#D8D98B' : 'transparent',
              opacity: isUnavailable && !isActive ? 0.35 : 1,
              paddingVertical: metrics.switcherItemPaddingVertical,
              paddingHorizontal: metrics.switcherPadding,
            }}>
            <Text
              className="font-inter-semibold"
              style={{
                color: isActive ? '#242B12' : isUnavailable ? '#F6F2E8' : '#F5F3D4',
                fontSize: metrics.switcherFontSize,
              }}>
              {MEAL_TYPE_LABEL[mealType]}
            </Text>
          </Pressable>
        );
      })}
    </ShadowSurface>
  );
}
