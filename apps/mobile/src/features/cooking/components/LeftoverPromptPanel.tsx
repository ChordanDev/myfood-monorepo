import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { UNIT_LABEL } from '@/utils/formatQuantity';
import { leftoverLineKey } from '../domain';
import type { LeftoverPromptFlow } from '../hooks/useLeftoverPrompt';
import { LeftoverPromptField, LeftoverPromptForm } from './LeftoverPromptForm';

const MAX_HEIGHT_RATIO = 0.85;
// The column of the server holds 255 characters.
const TITLE_MAX_LENGTH = 255;

interface LeftoverPromptPanelProps {
  prompt: LeftoverPromptFlow;
}

/**
 * Asks, once a meal was cooked, whether something was left: nothing, Ingredients that go back
 * to Inventory, or cooked portions kept as a Prepared leftover. It only draws the prompt.
 */
export function LeftoverPromptPanel({ prompt }: LeftoverPromptPanelProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  const choiceBorderColor = withOpacity(theme.icon, 0.3);

  return (
    <View
      testID="leftover-prompt-sheet"
      accessibilityViewIsModal
      style={[
        styles.panel,
        {
          backgroundColor: theme.colorDark,
          maxHeight: height * MAX_HEIGHT_RATIO,
          paddingBottom: insets.bottom + 16,
        },
      ]}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
        ¿Sobró algo?
      </Text>

      {prompt.step === 'choices' ? (
        <View style={styles.choices}>
          <Pressable
            testID="leftover-choice-none"
            accessibilityRole="button"
            onPress={prompt.close}
            style={({ pressed }) => [
              styles.choice,
              styles.choiceNone,
              {
                backgroundColor: theme.primaryAccent,
                borderColor: theme.primaryAccentIntense,
                opacity: pressed ? 0.9 : 1,
              },
            ]}>
            <Text style={[styles.choiceLabel, { color: theme.textBlack }]}>No sobró nada</Text>
          </Pressable>

          {prompt.offersIngredients ? (
            <Pressable
              testID="leftover-choice-ingredients"
              accessibilityRole="button"
              onPress={() => prompt.choose('ingredients')}
              style={({ pressed }) => [
                styles.choice,
                { borderColor: choiceBorderColor, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Text style={[styles.choiceLabel, { color: theme.textLight }]}>Ingredientes</Text>
            </Pressable>
          ) : null}

          <Pressable
            testID="leftover-choice-prepared"
            accessibilityRole="button"
            onPress={() => prompt.choose('prepared')}
            style={({ pressed }) => [
              styles.choice,
              { borderColor: choiceBorderColor, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text style={[styles.choiceLabel, { color: theme.textLight }]}>Comida preparada</Text>
          </Pressable>
        </View>
      ) : null}

      {prompt.step === 'ingredients' ? (
        <LeftoverPromptForm
          subtitle="Vuelven a tu inventario como sobra"
          isPending={prompt.isPending}
          errorMessage={prompt.errorMessage}
          canSubmit={prompt.canSaveIngredients}
          onSubmit={prompt.saveIngredients}
          onBack={prompt.back}>
          {prompt.lines.map((line) => (
            <LeftoverPromptField
              key={leftoverLineKey(line)}
              label={line.name}
              value={line.quantityText}
              onChangeText={(text) => prompt.setLineQuantity(line, text)}
              keyboardType="decimal-pad"
              trailing={UNIT_LABEL[line.unit]}
            />
          ))}
        </LeftoverPromptForm>
      ) : null}

      {prompt.step === 'prepared' ? (
        <LeftoverPromptForm
          isPending={prompt.isPending}
          errorMessage={prompt.errorMessage}
          canSubmit={prompt.canSavePrepared}
          onSubmit={prompt.savePrepared}
          onBack={prompt.back}>
          <LeftoverPromptField
            label="Título"
            value={prompt.title}
            onChangeText={prompt.setTitle}
            autoCapitalize="sentences"
            maxLength={TITLE_MAX_LENGTH}
          />
          <LeftoverPromptField
            label="Porciones"
            value={prompt.portionsText}
            onChangeText={prompt.setPortionsText}
            keyboardType="number-pad"
          />
        </LeftoverPromptForm>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    width: '100%',
  },
  choiceLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  choiceNone: {
    borderWidth: 2,
  },
  choices: {
    gap: 12,
    marginTop: 24,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // Over the keyboard there is less room than the panel may take: the fields scroll in it.
    flexShrink: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
  },
  title: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
});
