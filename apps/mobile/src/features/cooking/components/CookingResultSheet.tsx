import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { CookingSummary, LeftoverIngredientInput, PreparedLeftoverInput } from '../domain';
import { useLeftoverPrompt } from '../hooks/useLeftoverPrompt';
import { LeftoverPromptPanel } from './LeftoverPromptPanel';

interface CookingResultSheetProps {
  summary: CookingSummary | null;
  /**
   * Shown instead of a summary: why the meal could not be marked as cooked, or that it was
   * cooked already when the server has no summary to give.
   */
  errorMessage: string | null;
  onClose: () => void;
  /** The finish to ask about leftovers for, once its summary was closed. */
  leftoverPrompt: CookingSummary | null;
  /** Puts what is left of one Ingredient back in Inventory. */
  onAddLeftoverIngredient: (input: LeftoverIngredientInput) => Promise<unknown>;
  onCreatePreparedLeftover: (input: PreparedLeftoverInput) => Promise<unknown>;
  /** Closing the prompt in any way counts as "nothing was left". */
  onCloseLeftoverPrompt: () => void;
}

type Stage = 'result' | 'leftovers';

/**
 * Tells the user what marking a meal as cooked consumed, what was missing, or why it failed,
 * and then asks about leftovers.
 *
 * Both stages share one modal: iOS does not present a modal while another one is still being
 * dismissed, so the prompt takes the place of the summary instead of opening after it.
 */
export function CookingResultSheet({
  summary,
  errorMessage,
  onClose,
  leftoverPrompt,
  onAddLeftoverIngredient,
  onCreatePreparedLeftover,
  onCloseLeftoverPrompt,
}: CookingResultSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const prompt = useLeftoverPrompt({
    summary: leftoverPrompt,
    onAddIngredient: onAddLeftoverIngredient,
    onCreatePrepared: onCreatePreparedLeftover,
    onClose: onCloseLeftoverPrompt,
  });
  const visible = summary !== null || errorMessage !== null || leftoverPrompt !== null;
  const stage: Stage = leftoverPrompt !== null ? 'leftovers' : 'result';
  const [shownStage, setShownStage] = useState(stage);

  // The stage is kept on close, so the sheet does not change while it fades out.
  if (visible && stage !== shownStage) {
    setShownStage(stage);
  }

  const close = shownStage === 'leftovers' ? prompt.close : onClose;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={close}
      statusBarTranslucent>
      {/* Only the prompt has fields. Lifted by the keyboard, its panel still ends under the
          status bar. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.backdrop, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />

        {/* Siblings of the backdrop pressable, so a press on a panel never closes the sheet. */}
        {shownStage === 'leftovers' ? (
          <LeftoverPromptPanel prompt={prompt} />
        ) : (
          <View
            testID="cooking-result-sheet"
            accessibilityViewIsModal
            style={[
              styles.panel,
              { backgroundColor: theme.colorDark, paddingBottom: insets.bottom + 16 },
            ]}>
            {summary ? (
              <ScrollView style={styles.scroll}>
                <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
                  {summary.recipeName}
                </Text>
                <Text style={[styles.subtitle, { color: theme.textLight }]}>
                  Esto se descontó de tu inventario
                </Text>
                {summary.consumed.length === 0 ? (
                  <Text style={[styles.note, { color: theme.textLight }]}>
                    No había nada para descontar.
                  </Text>
                ) : (
                  summary.consumed.map((line) => (
                    <View key={`${line.ingredientId}:${line.unit}`} style={styles.row}>
                      <Text style={[styles.name, { color: theme.textLight }]}>{line.name}</Text>
                      <Text style={[styles.quantity, { color: theme.textLight }]}>
                        {line.quantity}
                      </Text>
                    </View>
                  ))
                )}
                {summary.shortages.length > 0 ? (
                  <View style={styles.shortages}>
                    <Text style={[styles.subtitle, { color: theme.primaryAccent }]}>Te faltó</Text>
                    {summary.shortages.map((line) => (
                      <View key={`${line.ingredientId}:${line.unit}`} style={styles.row}>
                        <Text style={[styles.name, { color: theme.textLight }]}>{line.name}</Text>
                        <Text style={[styles.quantity, { color: theme.primaryAccent }]}>
                          {line.missing}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            ) : (
              <Text style={[styles.note, { color: theme.textLight }]}>{errorMessage}</Text>
            )}

            <Pressable
              testID="cooking-result-close"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}>
              <Text style={[styles.closeLabel, { color: theme.textBlack }]}>Listo</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 48,
    width: '100%',
  },
  closeLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  name: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  note: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
  },
  quantity: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  scroll: {
    flexGrow: 0,
  },
  shortages: {
    marginTop: 16,
  },
  subtitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
    marginTop: 16,
  },
  title: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
});
