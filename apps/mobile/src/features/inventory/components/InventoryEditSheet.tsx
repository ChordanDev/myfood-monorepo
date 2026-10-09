import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { withOpacity } from '@/utils/colors';
import { UNIT_LABEL } from '@/utils/formatQuantity';
import { milliToInputText, parseQuantityInputMilli } from '../domain';
import type { InventoryItem } from '../types';

interface InventoryEditSheetProps {
  visible: boolean;
  item: InventoryItem | null;
  onSave: (quantityMilli: number) => void;
  onClose: () => void;
}

export function InventoryEditSheet({ visible, item, onSave, onClose }: InventoryEditSheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const { inputAnimatedStyle } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset: 0,
    bottomInset: insets.bottom,
    enabled: visible,
  });

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
          {/* Keyed by item so the fields never carry over the text typed for another one. */}
          {item ? (
            <InventoryEditForm key={item.id} item={item} onSave={onSave} onClose={onClose} />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

interface InventoryEditFormProps {
  item: InventoryItem;
  onSave: (quantityMilli: number) => void;
  onClose: () => void;
}

// Only the quantity can be changed: no endpoint edits the name or the notes of a lot.
function InventoryEditForm({ item, onSave, onClose }: InventoryEditFormProps) {
  const { theme } = useRecipeTheme();
  const [quantityText, setQuantityText] = useState(milliToInputText(item.quantityMilli));

  // The user types display units; the API takes thousandths.
  const quantityMilli = parseQuantityInputMilli(quantityText);
  const canSave = quantityMilli !== null;

  const fieldStyle = {
    backgroundColor: withOpacity(theme.icon, 0.15),
    borderColor: withOpacity(theme.icon, 0.3),
  };
  const inputProps = {
    placeholderTextColor: withOpacity(theme.textLight, 0.6),
    selectionColor: theme.primaryAccent,
  };

  const handleSave = () => {
    if (quantityMilli === null) {
      return;
    }

    onSave(quantityMilli);
  };

  return (
    <>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
        {item.name}
      </Text>
      {item.notes ? (
        <Text style={[styles.notes, { color: theme.textMedium }]}>{item.notes}</Text>
      ) : null}

      <View style={styles.fields}>
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: theme.textMedium }]}>Cantidad</Text>
          <View style={[styles.field, fieldStyle]}>
            <TextInput
              accessibilityLabel="Cantidad"
              value={quantityText}
              onChangeText={setQuantityText}
              keyboardType="decimal-pad"
              style={[styles.input, { color: theme.textLight }]}
              {...inputProps}
            />
            <Text style={[styles.unit, { color: theme.textMedium }]}>{UNIT_LABEL[item.unit]}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: theme.primaryAccent,
              borderColor: theme.primaryAccentIntense,
              opacity: !canSave ? 0.45 : pressed ? 0.9 : 1,
            },
          ]}>
          <Text style={[styles.saveLabel, { color: theme.textBlack }]}>Guardar</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.textButtonLabel, { color: theme.textLight }]}>Cancelar</Text>
        </Pressable>
      </View>
    </>
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
  fields: {
    gap: 14,
    marginTop: 20,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    paddingVertical: 12,
  },
  notes: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
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
  unit: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
});
