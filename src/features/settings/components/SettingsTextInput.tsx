import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';

// Text input for the editor sheets, drawn on the dark sheet surface.
export function SettingsTextInput({ style, ...inputProps }: TextInputProps) {
  const { theme } = useRecipeTheme();

  return (
    <TextInput
      placeholderTextColor={withOpacity(theme.textLight, 0.6)}
      selectionColor={theme.primaryAccent}
      {...inputProps}
      style={[
        styles.input,
        {
          backgroundColor: withOpacity(theme.icon, 0.15),
          borderColor: withOpacity(theme.icon, 0.3),
          color: theme.textLight,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
