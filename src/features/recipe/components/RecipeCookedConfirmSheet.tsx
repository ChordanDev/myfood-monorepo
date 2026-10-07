import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface RecipeCookedConfirmSheetProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before a meal is marked as cooked: marking it consumes its ingredients from the inventory. */
export function RecipeCookedConfirmSheet({
  visible,
  onConfirm,
  onCancel,
}: RecipeCookedConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />

        {/* Sibling of the backdrop pressable, so a press on the panel never closes the sheet. */}
        <View
          testID="recipe-cooked-confirm-sheet"
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: theme.colorDark, paddingBottom: insets.bottom + 16 },
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
            ¿Cocinaste la receta?
          </Text>

          <View style={styles.actions}>
            <Pressable
              testID="recipe-cooked-confirm-yes"
              accessibilityRole="button"
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.confirmButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}>
              <Text style={[styles.confirmLabel, { color: theme.textBlack }]}>Sí</Text>
            </Pressable>

            <Pressable
              testID="recipe-cooked-confirm-no"
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.cancelLabel, { color: theme.textLight }]}>No</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 24,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  cancelLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    width: '100%',
  },
  confirmLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
