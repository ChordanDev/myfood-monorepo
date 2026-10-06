import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface SettingsSheetProps {
  visible: boolean;
  title: string;
  saving: boolean;
  /** Save failure, shown above the actions while the sheet stays open. */
  errorMessage: string | null;
  onSave: () => void;
  onClose: () => void;
  /** The editor of the row that opened the sheet. */
  children: ReactNode;
}

const MAX_HEIGHT_RATIO = 0.85;

export function SettingsSheet({
  visible,
  title,
  saving,
  errorMessage,
  onSave,
  onClose,
  children,
}: SettingsSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { theme } = useRecipeTheme();

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        {/* Sibling of the backdrop pressable, so a press on the panel never closes the sheet. */}
        <View
          accessibilityViewIsModal
          testID="settings-sheet"
          style={[
            styles.panel,
            {
              backgroundColor: theme.colorDark,
              maxHeight: height * MAX_HEIGHT_RATIO,
              paddingBottom: insets.bottom + 16,
            },
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
            {title}
          </Text>

          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}>
            {children}
          </ScrollView>

          {errorMessage ? (
            <Text
              accessibilityRole="alert"
              selectable
              testID="settings-sheet-error"
              style={[styles.error, { color: theme.primaryAccent }]}>
              {errorMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving}
              onPress={onSave}
              testID="settings-sheet-save"
              style={({ pressed }) => [
                styles.saveButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: saving ? 0.6 : pressed ? 0.9 : 1,
                },
              ]}>
              {saving ? <ActivityIndicator size="small" color={theme.textBlack} /> : null}
              <Text style={[styles.saveLabel, { color: theme.textBlack }]}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={onClose}
              testID="settings-sheet-cancel"
              style={({ pressed }) => [styles.cancelButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.cancelLabel, { color: theme.textLight }]}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 4,
    marginTop: 20,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: 16,
  },
  bodyContent: {
    gap: 16,
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
  error: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
  },
  saveButton: {
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
  saveLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  title: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
});
