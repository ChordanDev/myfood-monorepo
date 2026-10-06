import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';

interface SettingsRowProps {
  label: string;
  testID: string;
  value?: string;
  /** Without it the row is read-only: no button role and no chevron. */
  onPress?: () => void;
  disabled?: boolean;
  /** `alert` is for destructive actions such as signing out. */
  tone?: 'default' | 'alert';
  /** Actions that do not open an editor hide the chevron. */
  hideChevron?: boolean;
}

export function SettingsRow({
  label,
  testID,
  value,
  onPress,
  disabled = false,
  tone = 'default',
  hideChevron = false,
}: SettingsRowProps) {
  const { theme } = useRecipeTheme();
  const mutedColor = withOpacity(theme.textDark, 0.6);
  const accessibilityLabel = value ? `${label}, ${value}` : label;

  const content = (
    <>
      <Text style={[styles.label, { color: tone === 'alert' ? theme.alert : theme.textDark }]}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={[styles.value, { color: mutedColor }]}>
          {value}
        </Text>
      ) : null}
      {onPress && !disabled && !hideChevron ? (
        <ChevronRight size={18} color={mutedColor} strokeWidth={2.5} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} testID={testID} style={styles.row}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  value: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: '55%',
    textAlign: 'right',
  },
});
