import { Pressable, Text } from 'react-native';
import { ShadowSurface } from '@/components';
import type { MockMealType } from '@/mocks';

interface FoodTypeSwitcherProps {
  value: MockMealType | null;
  availableTypes?: MockMealType[];
  onChange?: (mealType: MockMealType) => void;
}

const ORDERED_MEAL_TYPES: MockMealType[] = ['desayuno', 'almuerzo', 'cena'];

const MEAL_TYPE_LABEL: Record<MockMealType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
};

export function FoodTypeSwitcher({ value, availableTypes = [], onChange }: FoodTypeSwitcherProps) {
  const availableTypesSet = new Set(availableTypes);

  return (
    <ShadowSurface className="flex-row rounded-3xl bg-[#1B210E] p-2">
      {ORDERED_MEAL_TYPES.map((mealType) => {
        const isActive = value === mealType;
        const isUnavailable = !availableTypesSet.has(mealType);

        return (
          <Pressable
            key={mealType}
            onPress={() => onChange?.(mealType)}
            disabled={isUnavailable}
            className="flex-1 items-center rounded-3xl px-2 py-2"
            accessibilityState={{ disabled: isUnavailable, selected: isActive }}
            style={{
              backgroundColor: isActive ? '#D8D98B' : 'transparent',
              opacity: isUnavailable && !isActive ? 0.35 : 1,
            }}>
            <Text
              className="font-inter-semibold text-sm"
              style={{ color: isActive ? '#242B12' : '#F6F2E8' }}>
              {MEAL_TYPE_LABEL[mealType]}
            </Text>
          </Pressable>
        );
      })}
    </ShadowSurface>
  );
}
