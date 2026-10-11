import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { CookingSummary } from '../domain';

interface CookingResultSheetProps {
  summary: CookingSummary | null;
  /** Why the meal could not be marked as cooked; shown instead of a summary. */
  errorMessage: string | null;
  onClose: () => void;
}

/** Tells the user what marking a meal as cooked consumed, what was missing, or why it failed. */
export function CookingResultSheet({ summary, errorMessage, onClose }: CookingResultSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const visible = summary !== null || errorMessage !== null;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

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
      </View>
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
