import { Pressable, Text } from 'react-native';
import type { OnboardingTheme } from '@/features/preferences/components/onboarding/OnboardingSectionCard';

interface OnboardingChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: OnboardingTheme;
}

export function OnboardingChip({ label, selected, onPress, theme }: OnboardingChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="items-center active:opacity-80"
      style={{
        backgroundColor: selected ? theme.colorBlack : 'rgba(196, 188, 156, 0.72)',
        borderColor: selected ? theme.primaryAccent : 'rgba(69, 64, 47, 0.18)',
        borderRadius: 999,
        borderWidth: selected ? 2 : 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}>
      <Text
        className="font-inter-semibold text-sm"
        style={{ color: selected ? theme.primaryAccent : theme.textBlack }}>
        {label}
      </Text>
    </Pressable>
  );
}
