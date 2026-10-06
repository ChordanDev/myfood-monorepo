import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { formatItemMetaLine, formatItemNameLine } from '../domain';
import type { BestOffer, ShoppingListItem } from '../types';

// Share of the window the rows may take before they scroll, so the actions stay on screen.
const LIST_MAX_HEIGHT_RATIO = 0.4;
const TAKE_OUT_ICON_SIZE = 20;

export interface ShoppingCartSheetProps {
  visible: boolean;
  // Rows in the cart, planned and manual, as they are derived now.
  items: ShoppingListItem[];
  // Best offer of each row, keyed by item id. A row without an entry has no price.
  bestOffers: Record<string, BestOffer>;
  onTakeOut: (itemId: string) => void;
  // Called once per opening; the sheet asks to close right after.
  onConfirm: () => void;
  onClose: () => void;
}

// Bottom sheet with what was marked, and the button that buys it. Mirrors the add sheet.
export function ShoppingCartSheet({
  visible,
  items,
  bestOffers,
  onTakeOut,
  onConfirm,
  onClose,
}: ShoppingCartSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  const [shownItems, setShownItems] = useState(items);
  // A ref, not state: two presses can land before the first one has re-rendered anything.
  const hasConfirmedRef = useRef(false);

  // The rows follow the cart only while the sheet is open. Confirming empties the cart at
  // once, and iOS keeps the panel mounted while it fades out: it leaves showing what was
  // bought, not the empty hint.
  if (visible && shownItems !== items) {
    setShownItems(items);
  }

  // Each opening accepts one confirmation.
  useEffect(() => {
    if (visible) hasConfirmedRef.current = false;
  }, [visible]);

  const isEmpty = shownItems.length === 0;

  // A second press, or one that lands while the sheet closes, would buy the cart again with
  // whatever was marked since: one confirmation per opening, and none once it is closing.
  const handleConfirm = () => {
    if (!visible || isEmpty || hasConfirmedRef.current) return;

    hasConfirmedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm();
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
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: theme.colorDark, paddingBottom: insets.bottom + 16 },
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
            Tu carrito
          </Text>

          {isEmpty ? (
            <Text style={[styles.hint, { color: withOpacity(theme.textLight, 0.6) }]}>
              Todavía no marcaste nada.
            </Text>
          ) : (
            <ScrollView
              style={[styles.list, { maxHeight: Math.round(windowHeight * LIST_MAX_HEIGHT_RATIO) }]}
              showsVerticalScrollIndicator={false}>
              {shownItems.map((item) => {
                const nameLine = formatItemNameLine(item);
                const metaLine = formatItemMetaLine(bestOffers[item.id]);

                return (
                  <View key={item.id} style={styles.row}>
                    {/* One element for both lines; the button next to it is read apart. */}
                    <View
                      accessible
                      accessibilityLabel={`${nameLine}, ${metaLine}`}
                      style={styles.lines}>
                      <Text style={[styles.name, { color: theme.textLight }]}>{nameLine}</Text>
                      <Text style={[styles.meta, { color: theme.textMedium }]}>{metaLine}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Sacar del carrito, ${nameLine}`}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onTakeOut(item.id);
                      }}
                      style={({ pressed }) => [styles.takeOut, { opacity: pressed ? 0.6 : 1 }]}>
                      <X size={TAKE_OUT_ICON_SIZE} color={theme.icon} strokeWidth={2.5} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isEmpty }}
              disabled={isEmpty}
              onPress={handleConfirm}
              style={({ pressed }) => [
                styles.confirmButton,
                {
                  backgroundColor: theme.primaryAccent,
                  borderColor: theme.primaryAccentIntense,
                  opacity: isEmpty ? 0.5 : pressed ? 0.9 : 1,
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
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
  },
  // A 44 pt target around the icon, pulled into the padding of the panel so the icon lines
  // up with its right edge.
  takeOut: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginRight: -12,
    width: 44,
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
