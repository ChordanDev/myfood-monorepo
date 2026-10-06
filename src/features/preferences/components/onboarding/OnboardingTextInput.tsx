import { type Ref } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface OnboardingTextInputProps extends TextInputProps {
  ref?: Ref<TextInput>;
  theme: RecipeThemeConfig;
}

// Text typed straight onto a field card: no box of its own, the card is the
// input. Callers can still override the size through `style`.
export function OnboardingTextInput({
  ref,
  style,
  theme,
  ...inputProps
}: OnboardingTextInputProps) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={withOpacity(theme.textBlack, 0.45)}
      selectionColor={theme.colorDark}
      {...inputProps}
      style={[
        {
          color: theme.textBlack,
          fontFamily: 'Inter_600SemiBold',
          fontSize: 20,
          padding: 0,
        },
        style,
      ]}
    />
  );
}
