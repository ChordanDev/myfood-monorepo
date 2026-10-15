import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthErrorMessage } from '@/api/errors';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { withOpacity } from '@/utils/colors';
import {
  LEFTOVER_NOTES_MAX_LENGTH,
  LEFTOVER_TITLE_MAX_LENGTH,
  readLeftoverDraft,
  type LeftoverDraft,
} from '../domain';
import type { CreatePreparedLeftoverInput } from '../types';

const EMPTY_DRAFT: LeftoverDraft = { title: '', portionsText: '1', notes: '' };

export interface LeftoverAddSheetProps {
  visible: boolean;
  // Stores the leftover; the sheet closes once it resolves and shows the error if it rejects.
  onAdd: (input: CreatePreparedLeftoverInput) => Promise<unknown>;
  onClose: () => void;
}

// Bottom sheet that stores a loose Prepared leftover: one with no Scheduled meal behind it.
// Mirrors the Shopping "add item" sheet, but waits for the server before closing.
export function LeftoverAddSheet({ visible, onAdd, onClose }: LeftoverAddSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [wasVisible, setWasVisible] = useState(visible);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // A ref, not state: two submits can land before the first one has re-rendered anything.
  const isWritingRef = useRef(false);
  // The panel rests on the bottom edge of the window, so it rises by the whole keyboard.
  const { inputAnimatedStyle } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset: 0,
    bottomInset: insets.bottom,
    enabled: visible,
  });

  // Every opening starts empty. The fields are kept on close so they do not vanish mid fade-out.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(EMPTY_DRAFT);
      setErrorMessage(null);
    }
  }

  const input = readLeftoverDraft(draft);
  const canAdd = input !== null && !isPending;

  // Shared by the button and the return key. Nothing is sent once the sheet is closing: it
  // stays mounted while it fades out, so a late tap could store the leftover twice.
  const handleAdd = async () => {
    if (!visible || input === null || isWritingRef.current) return;

    isWritingRef.current = true;
    setIsPending(true);
    setErrorMessage(null);

    try {
      await onAdd(input);
      onClose();
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      isWritingRef.current = false;
      setIsPending(false);
    }
  };

  // A write on its way is waited for.
  const close = () => {
    if (!isWritingRef.current) onClose();
  };

  const setField = (field: keyof LeftoverDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const inputColors = {
    backgroundColor: withOpacity(theme.icon, 0.15),
    borderColor: withOpacity(theme.icon, 0.3),
    color: theme.textLight,
  };
  const placeholderColor = withOpacity(theme.textLight, 0.6);

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={close}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />

        {/* Sibling of the backdrop pressable, so a press on the panel never closes the sheet. */}
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: theme.colorDark, paddingBottom: insets.bottom + 16 },
            inputAnimatedStyle,
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
            ¿Qué sobró?
          </Text>

          <TextInput
            value={draft.title}
            onChangeText={setField('title')}
            onSubmitEditing={() => void handleAdd()}
            maxLength={LEFTOVER_TITLE_MAX_LENGTH}
            editable={!isPending}
            autoFocus
            returnKeyType="done"
            submitBehavior="submit"
            enablesReturnKeyAutomatically
            autoCapitalize="sentences"
            accessibilityLabel="Nombre de la sobra"
            placeholder="Ej.: guiso de lentejas"
            placeholderTextColor={placeholderColor}
            selectionColor={theme.primaryAccent}
            cursorColor={theme.primaryAccent}
            style={[styles.input, inputColors]}
          />

          <TextInput
            value={draft.portionsText}
            onChangeText={setField('portionsText')}
            onSubmitEditing={() => void handleAdd()}
            editable={!isPending}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Porciones"
            selectionColor={theme.primaryAccent}
            cursorColor={theme.primaryAccent}
            style={[styles.input, inputColors]}
          />

          <TextInput
            value={draft.notes}
            onChangeText={setField('notes')}
            onSubmitEditing={() => void handleAdd()}
            maxLength={LEFTOVER_NOTES_MAX_LENGTH}
            editable={!isPending}
            returnKeyType="done"
            autoCapitalize="sentences"
            accessibilityLabel="Notas"
            placeholder="Notas (opcional)"
            placeholderTextColor={placeholderColor}
            selectionColor={theme.primaryAccent}
            cursorColor={theme.primaryAccent}
            style={[styles.input, inputColors]}
          />

          {errorMessage ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: theme.textLight }]}>
              {errorMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAdd, busy: isPending }}
              disabled={!canAdd}
              onPress={() => void handleAdd()}
              style={({ pressed }) => [
                styles.addButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: canAdd ? (pressed ? 0.9 : 1) : 0.5,
                },
              ]}>
              <Text style={[styles.addLabel, { color: theme.textBlack }]}>
                {isPending ? 'Guardando…' : 'Guardar'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={close}
              style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.textButtonLabel, { color: theme.textLight }]}>Cancelar</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 24,
  },
  addButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    width: '100%',
  },
  addLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  // Neutral scrim, independent of the meal palette: the literal `docs/THEMING.md` allows.
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  error: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    textAlign: 'center',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
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
  title: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
});
