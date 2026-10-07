import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { withOpacity } from '@/utils/colors';

export interface ShoppingAddItemSheetProps {
  visible: boolean;
  // Called with the trimmed, non-empty name; the sheet asks to close right after.
  onAdd: (name: string) => void;
  onClose: () => void;
}

// Bottom sheet that asks for the name of a manual item. Mirrors the Home "eat today" sheet.
export function ShoppingAddItemSheet({ visible, onAdd, onClose }: ShoppingAddItemSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const [name, setName] = useState('');
  const [wasVisible, setWasVisible] = useState(visible);
  // A ref, not state: two submits can land before the first one has re-rendered anything.
  const hasAddedRef = useRef(false);
  // The panel rests on the bottom edge of the window, so it rises by the whole keyboard.
  const { inputAnimatedStyle } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset: 0,
    bottomInset: insets.bottom,
    enabled: visible,
  });

  // Every opening starts empty. The text is kept on close so it does not vanish mid fade-out.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setName('');
  }

  // Each opening accepts one add.
  useEffect(() => {
    if (visible) hasAddedRef.current = false;
  }, [visible]);

  const trimmedName = name.trim();
  const canAdd = trimmedName.length > 0;

  // Shared by the button and the return key, which stays enabled on Android with no text.
  // The name is kept after closing and iOS keeps the panel mounted while it fades out, so a
  // second return or a late tap would add the same item again: one add per opening, and none
  // once the sheet is closing.
  const handleAdd = () => {
    if (!visible || !canAdd || hasAddedRef.current) return;

    hasAddedRef.current = true;
    onAdd(trimmedName);
    onClose();
  };

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

        {/* Sibling of the backdrop pressable, so a press on the panel never closes the sheet. */}
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: theme.colorDark, paddingBottom: insets.bottom + 16 },
            inputAnimatedStyle,
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
            ¿Qué querés agregar?
          </Text>

          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={handleAdd}
            autoFocus
            returnKeyType="done"
            // An empty return keeps the keyboard up instead of leaving the sheet half used.
            submitBehavior="submit"
            enablesReturnKeyAutomatically
            autoCapitalize="sentences"
            accessibilityLabel="Nombre del producto"
            placeholder="Ej.: papel de cocina"
            placeholderTextColor={withOpacity(theme.textLight, 0.6)}
            selectionColor={theme.primaryAccent}
            cursorColor={theme.primaryAccent}
            style={[
              styles.input,
              {
                backgroundColor: withOpacity(theme.icon, 0.15),
                borderColor: withOpacity(theme.icon, 0.3),
                color: theme.textLight,
              },
            ]}
          />

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAdd }}
              disabled={!canAdd}
              onPress={handleAdd}
              style={({ pressed }) => [
                styles.addButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: canAdd ? (pressed ? 0.9 : 1) : 0.5,
                },
              ]}>
              <Text style={[styles.addLabel, { color: theme.textBlack }]}>Agregar</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
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
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginTop: 16,
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
