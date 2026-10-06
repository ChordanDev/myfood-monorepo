import { Pressable, Text, View } from 'react-native';
import { Minus, Plus, type LucideIcon } from 'lucide-react-native';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';
import {
  MAX_HOUSEHOLD_SIZE,
  MIN_HOUSEHOLD_SIZE,
  clampHouseholdSize,
} from '@/features/preferences/utils/onboardingSteps';

interface HouseholdSizeStepperProps {
  value: number;
  onChange: (value: number) => void;
  theme: RecipeThemeConfig;
}

export function HouseholdSizeStepper({ value, onChange, theme }: HouseholdSizeStepperProps) {
  const noun = value === 1 ? 'comensal' : 'comensales';

  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 14 }}>
      <StepperButton
        accessibilityLabel="Una persona menos"
        disabled={value <= MIN_HOUSEHOLD_SIZE}
        Icon={Minus}
        onPress={() => onChange(clampHouseholdSize(value - 1))}
        theme={theme}
      />
      <View
        accessible
        accessibilityLabel={`${value} ${noun}`}
        accessibilityLiveRegion="polite"
        style={{ alignItems: 'baseline', flex: 1, flexDirection: 'row', gap: 8 }}>
        <Text
          style={{
            color: theme.textBlack,
            fontFamily: 'MontserratAlternates_900Black',
            fontSize: 28,
            fontVariant: ['tabular-nums'],
            lineHeight: 34,
          }}>
          {value}
        </Text>
        <Text
          style={{
            color: withOpacity(theme.textBlack, 0.6),
            fontFamily: 'Inter_500Medium',
            fontSize: 14,
            lineHeight: 20,
          }}>
          {noun}
        </Text>
      </View>
      <StepperButton
        accessibilityLabel="Una persona más"
        disabled={value >= MAX_HOUSEHOLD_SIZE}
        Icon={Plus}
        onPress={() => onChange(clampHouseholdSize(value + 1))}
        theme={theme}
      />
    </View>
  );
}

interface StepperButtonProps {
  accessibilityLabel: string;
  disabled: boolean;
  Icon: LucideIcon;
  onPress: () => void;
  theme: RecipeThemeConfig;
}

function StepperButton({ accessibilityLabel, disabled, Icon, onPress, theme }: StepperButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: theme.colorDark,
        borderRadius: 22,
        height: 44,
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        width: 44,
      })}>
      <Icon color={theme.textLight} size={20} strokeWidth={2.5} />
    </Pressable>
  );
}
