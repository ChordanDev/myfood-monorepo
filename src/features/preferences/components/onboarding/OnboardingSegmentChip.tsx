import { Pressable, Text } from 'react-native';
import type { OnboardingTheme } from '@/features/preferences/components/onboarding/OnboardingSectionCard';

interface OnboardingSegmentChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: OnboardingTheme;
}

export function OnboardingSegmentChip({
  label,
  selected,
  onPress,
  theme,
}: OnboardingSegmentChipProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: selected ? 'rgba(196, 188, 156, 0.18)' : 'transparent',
        borderWidth: 1,
        borderColor: selected ? 'rgba(230, 148, 71, 0.58)' : 'transparent',
        borderRadius: 999,
        flex: 1,
        opacity: pressed ? 0.8 : 1,
        paddingHorizontal: 10,
        paddingVertical: 10,
      })}>
      <Text
        style={{
          color: selected ? theme.textLight : 'rgba(237, 232, 213, 0.52)',
          fontFamily: 'Inter_600SemiBold',
          fontSize: 12.25,
          lineHeight: 17.5,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
