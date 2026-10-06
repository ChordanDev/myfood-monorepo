import { Pressable, Text } from 'react-native';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface OnboardingChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: RecipeThemeConfig;
  /** `radio` for one choice out of a group, `checkbox` when several can be on. */
  role?: 'radio' | 'checkbox';
}

// A choice inside a field card. Unselected it is an outline on the light
// card; selected it becomes a dark surface with light text.
export function OnboardingChoiceChip({
  label,
  selected,
  onPress,
  theme,
  role = 'radio',
}: OnboardingChoiceChipProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: selected ? theme.colorDark : undefined,
        borderColor: selected ? theme.colorDark : withOpacity(theme.colorDark, 0.3),
        borderRadius: 22,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 44,
        opacity: pressed ? 0.8 : 1,
        paddingHorizontal: 16,
      })}>
      <Text
        style={{
          color: selected ? theme.textLight : theme.textBlack,
          fontFamily: 'Inter_600SemiBold',
          fontSize: 14,
          lineHeight: 18,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
