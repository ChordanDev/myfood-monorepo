import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';

interface LeftoverPromptFormProps {
  /** Read-only line above the fields. */
  subtitle?: string;
  /** The save on its way: every action waits for it. */
  isPending: boolean;
  /** Failure of the last save, shown above the actions while the sheet stays open. */
  errorMessage: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
  /** Returns to the choices. */
  onBack: () => void;
  /** The fields. */
  children: ReactNode;
}

/** A step of the leftover prompt that writes: its fields, then "Guardar" and the way back. */
export function LeftoverPromptForm({
  subtitle,
  isPending,
  errorMessage,
  canSubmit,
  onSubmit,
  onBack,
  children,
}: LeftoverPromptFormProps) {
  const { theme } = useRecipeTheme();
  const isSubmitDisabled = isPending || !canSubmit;

  return (
    <>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: theme.textMedium }]}>{subtitle}</Text>
      ) : null}

      <ScrollView
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}>
        {children}
      </ScrollView>

      {errorMessage ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.primaryAccent }]}>
          {errorMessage}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          testID="leftover-prompt-save"
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitDisabled, busy: isPending }}
          disabled={isSubmitDisabled}
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: theme.primaryAccent,
              borderColor: theme.primaryAccentIntense,
              opacity: isSubmitDisabled ? 0.45 : pressed ? 0.9 : 1,
            },
          ]}>
          {isPending ? <ActivityIndicator size="small" color={theme.textBlack} /> : null}
          <Text style={[styles.submitLabel, { color: theme.textBlack }]}>
            {isPending ? 'Guardando…' : 'Guardar'}
          </Text>
        </Pressable>

        <Pressable
          testID="leftover-prompt-back"
          accessibilityRole="button"
          accessibilityState={{ disabled: isPending }}
          disabled={isPending}
          onPress={onBack}
          style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.textButtonLabel, { color: theme.textLight }]}>Volver</Text>
        </Pressable>
      </View>
    </>
  );
}

interface LeftoverPromptFieldProps extends TextInputProps {
  label: string;
  /** Text after the input, such as the unit of a quantity. */
  trailing?: string;
}

export function LeftoverPromptField({ label, trailing, ...inputProps }: LeftoverPromptFieldProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.textMedium }]}>{label}</Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: withOpacity(theme.icon, 0.15),
            borderColor: withOpacity(theme.icon, 0.3),
          },
        ]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={withOpacity(theme.textLight, 0.6)}
          selectionColor={theme.primaryAccent}
          style={[styles.input, { color: theme.textLight }]}
          {...inputProps}
        />
        {trailing ? (
          <Text style={[styles.trailing, { color: theme.textMedium }]}>{trailing}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 24,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: 20,
  },
  bodyContent: {
    gap: 14,
  },
  error: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
  field: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    paddingVertical: 12,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    width: '100%',
  },
  submitLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  textButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  textButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  trailing: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
});
