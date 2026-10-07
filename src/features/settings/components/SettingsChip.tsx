import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';

interface SettingsChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}

// Option chip for the editor sheets, drawn on the dark sheet surface.
export function SettingsChip({ label, selected, onPress, testID }: SettingsChipProps) {
  const { theme } = useRecipeTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.primaryAccent : withOpacity(theme.icon, 0.15),
          borderColor: selected ? theme.primaryAccentIntense : withOpacity(theme.icon, 0.3),
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <Text style={[styles.label, { color: selected ? theme.textBlack : theme.textLight }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SettingsChipGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  group: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
});
