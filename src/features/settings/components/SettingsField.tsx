import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface SettingsFieldProps {
  /** Omitted when the sheet title already names the only field. */
  label?: string;
  hint?: string;
  /** Validation message, shown right under the control. */
  error?: string | null;
  errorTestID?: string;
  children: ReactNode;
}

export function SettingsField({ label, hint, error, errorTestID, children }: SettingsFieldProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.label, { color: theme.textMedium }]}>{label}</Text> : null}
      {children}
      {hint ? <Text style={[styles.hint, { color: theme.textMedium }]}>{hint}</Text> : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          testID={errorTestID}
          style={[styles.error, { color: theme.primaryAccent }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  field: {
    gap: 8,
  },
  hint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
});
