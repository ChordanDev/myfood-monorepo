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
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: selected ? theme.colorBlack : 'rgba(196, 188, 156, 0.72)',
        borderColor: selected ? theme.primaryAccent : 'rgba(69, 64, 47, 0.18)',
        borderRadius: 999,
        borderWidth: selected ? 2 : 1,
        opacity: pressed ? 0.8 : 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
      })}>
      <Text
        style={{
          color: selected ? theme.primaryAccent : theme.textBlack,
          fontFamily: 'Inter_600SemiBold',
          fontSize: 12.25,
          lineHeight: 17.5,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
