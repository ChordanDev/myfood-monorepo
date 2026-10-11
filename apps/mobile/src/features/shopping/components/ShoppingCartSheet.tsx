import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { UNIT_LABEL } from '@/utils/formatQuantity';
import { withOpacity } from '@/utils/colors';
import {
  formatHiddenCartItemsNotice,
  formatQuantityInput,
  formatSuggestedQuantity,
  getChangedCheckoutLines,
  parseBoughtQuantityMilli,
} from '../domain';
import type { CheckoutLine, ShoppingCartLine } from '../types';

// Share of the window the rows may take before they scroll, so the actions stay on screen.
const LIST_MAX_HEIGHT_RATIO = 0.4;

export interface ShoppingCartSheetProps {
  visible: boolean;
  // The lines of the Cart, each with the quantity the Cart holds of it.
  lines: ShoppingCartLine[];
  // The items of the Cart with no line here: the ones for a meal after the date the list
  // reaches. A confirm buys them too, at the quantity the Cart holds.
  hiddenItemsCount: number;
  // The purchase was asked for and the server has not answered yet.
  isConfirming: boolean;
  // Why the server refused the last purchase, while the Cart is still there to buy.
  errorMessage?: string;
  // Called with the lines bought at another quantity than the Cart holds, and only those. The
  // sheet stays open: whoever asked closes it once the server answers.
  onConfirm: (lines: CheckoutLine[]) => void;
  onClose: () => void;
}

// What the fields read when the sheet opens: what the Cart holds of each line.
function getSuggestedTexts(lines: ShoppingCartLine[]) {
  return Object.fromEntries(
    lines.map(({ id, quantityMilli }) => [id, formatQuantityInput(quantityMilli)])
  );
}

// Bottom sheet with what was marked, how much of each line was bought, and the button that
// buys it. Mirrors the add sheet.
export function ShoppingCartSheet({
  visible,
  lines,
  hiddenItemsCount,
  isConfirming,
  errorMessage,
  onConfirm,
  onClose,
}: ShoppingCartSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  const [shownLines, setShownLines] = useState(lines);
  const [shownHiddenItemsCount, setShownHiddenItemsCount] = useState(hiddenItemsCount);
  // What each field reads, keyed by line id. A line without an entry reads what the Cart holds.
  const [quantityTexts, setQuantityTexts] = useState<Record<string, string>>({});
  const [wasVisible, setWasVisible] = useState(visible);
  // The panel rests on the bottom edge of the window, so it rises by the whole keyboard.
  const { inputAnimatedStyle } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset: 0,
    bottomInset: insets.bottom,
    enabled: visible,
  });

  // The rows and the notice follow the cart only while the sheet is open. Buying empties the
  // cart at once and iOS keeps the panel mounted while it fades out: it leaves showing what was
  // bought, not the empty hint.
  if (visible && shownLines !== lines) {
    setShownLines(lines);
  }
  if (visible && shownHiddenItemsCount !== hiddenItemsCount) {
    setShownHiddenItemsCount(hiddenItemsCount);
  }

  // Every opening starts from what the Cart holds. What was typed is kept on close so it does
  // not jump back mid fade-out.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setQuantityTexts({});
  }

  const suggestedTexts = getSuggestedTexts(shownLines);
  const getQuantityText = (lineId: string) => quantityTexts[lineId] ?? suggestedTexts[lineId];

  const boughtQuantities: Record<string, number> = {};
  let isEveryQuantityValid = true;

  for (const { id } of shownLines) {
    const bought = parseBoughtQuantityMilli(getQuantityText(id));

    if (bought === undefined) isEveryQuantityValid = false;
    else boughtQuantities[id] = bought;
  }

  const hasLines = shownLines.length > 0;
  // A Cart whose items are all outside the chosen dates has no line here and is still to buy.
  const isEmpty = !hasLines && shownHiddenItemsCount === 0;
  const canConfirm = visible && !isEmpty && !isConfirming && isEveryQuantityValid;

  // A press that lands while the sheet closes, or while the purchase is on its way, buys
  // nothing: the server would be asked for the same Cart twice.
  const handleConfirm = () => {
    if (!canConfirm) return;

    onConfirm(getChangedCheckoutLines(shownLines, boughtQuantities));
  };

  const inputColors = {
    backgroundColor: withOpacity(theme.icon, 0.15),
    borderColor: withOpacity(theme.icon, 0.3),
    color: theme.textLight,
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
            Tu carrito
          </Text>

          {isEmpty ? (
            <Text style={[styles.hint, { color: withOpacity(theme.textLight, 0.6) }]}>
              Todavía no marcaste nada.
            </Text>
          ) : null}

          {hasLines ? (
            <ScrollView
              style={[styles.list, { maxHeight: Math.round(windowHeight * LIST_MAX_HEIGHT_RATIO) }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {shownLines.map((line) => {
                const suggested = formatSuggestedQuantity(line.quantityMilli, line.unit);

                return (
                  <View key={line.id} style={styles.row}>
                    {/* One element for both lines; the field next to it is read apart. */}
                    <View
                      accessible
                      accessibilityLabel={`${line.name}, ${suggested}`}
                      style={styles.lines}>
                      <Text style={[styles.name, { color: theme.textLight }]}>{line.name}</Text>
                      <Text style={[styles.meta, { color: theme.textMedium }]}>{suggested}</Text>
                    </View>
                    <TextInput
                      testID={`shopping-cart-quantity-${line.id}`}
                      value={getQuantityText(line.id)}
                      onChangeText={(text) =>
                        setQuantityTexts((texts) => ({ ...texts, [line.id]: text }))
                      }
                      editable={!isConfirming}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      selectTextOnFocus
                      accessibilityLabel={`Cantidad comprada, ${line.name}`}
                      selectionColor={theme.primaryAccent}
                      cursorColor={theme.primaryAccent}
                      style={[styles.quantityInput, inputColors]}
                    />
                    <Text style={[styles.unit, { color: theme.textMedium }]}>
                      {UNIT_LABEL[line.unit]}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Not an alert: nothing went wrong, it says what else the button buys. */}
          {shownHiddenItemsCount > 0 ? (
            <Text
              accessibilityRole="text"
              style={[styles.hint, { color: withOpacity(theme.textLight, 0.6) }]}>
              {formatHiddenCartItemsNotice(shownHiddenItemsCount)}
            </Text>
          ) : null}

          {errorMessage ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: theme.textLight }]}>
              {errorMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canConfirm, busy: isConfirming }}
              disabled={!canConfirm}
              onPress={handleConfirm}
              style={({ pressed }) => [
                styles.confirmButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: canConfirm ? (pressed ? 0.9 : 1) : 0.5,
                },
              ]}>
              <Text style={[styles.confirmLabel, { color: theme.textBlack }]}>
                Marcar como comprado
              </Text>
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
  // Neutral scrim, independent of the meal palette: the literal `docs/THEMING.md` allows.
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
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
  error: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 16,
    textAlign: 'center',
  },
  hint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 16,
    textAlign: 'center',
  },
  lines: {
    flex: 1,
  },
  list: {
    // Never taller than its rows: a short cart does not stretch the panel.
    flexGrow: 0,
    marginTop: 16,
  },
  meta: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
  },
  quantityInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 12,
    textAlign: 'right',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingVertical: 4,
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
  // Wide enough for the longest unit, so the fields of every row line up.
  unit: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    minWidth: 20,
  },
});
