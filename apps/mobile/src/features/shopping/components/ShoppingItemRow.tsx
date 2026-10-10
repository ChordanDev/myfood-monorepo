import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import { formatItemNameLine } from '../domain';
import type { ShoppingListItem } from '../types';
import { ShoppingCheckbox } from './ShoppingCheckbox';

export interface ShoppingItemRowProps {
  item: ShoppingListItem;
  // Second line of the row: the meals a planned line is for. Without it the row is one line.
  meta?: string;
  // Without `onToggle` or `onRemove` the row is read-only: it shows the item and nothing on it
  // can be pressed. `onToggle` makes the whole row a checkbox. `onRemove` lets it be held to
  // remove it; with only `onRemove` there is no checkbox, since marking a row is not offered.
  onToggle?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
}

// The long press has no visible affordance, so the same removal is offered as an action to
// screen-reader and switch users.
const REMOVE_ACTION = 'remove';
const ACCESSIBILITY_ACTIONS = [{ name: REMOVE_ACTION, label: 'Quitar de la lista' }];

// What a read-only row in the cart adds to its label: it has no checkbox to say so.
const IN_CART_LABEL = 'en el carrito';

const META_OPACITY = 0.6;
// A row in the cart is struck through and dimmed: marked, not bought yet.
const IN_CART_OPACITY = 0.45;

export function ShoppingItemRow({ item, meta, onToggle, onRemove }: ShoppingItemRowProps) {
  const { theme } = useRecipeTheme();
  const isInCart = item.status === 'in_cart';
  const nameLine = formatItemNameLine(item);
  // An explicit label replaces the text of the children, so it carries every line.
  const label = meta === undefined ? nameLine : `${nameLine}, ${meta}`;
  const inCartColor = withOpacity(theme.textBlack, IN_CART_OPACITY);

  // Marking a row is a state change, not a palette change: it must not crossfade.
  const nameStyle = useAnimatedThemeStyle(
    { color: isInCart ? inCartColor : theme.textBlack },
    { immediateKey: isInCart }
  );
  const metaStyle = useAnimatedThemeStyle(
    { color: isInCart ? inCartColor : withOpacity(theme.textBlack, META_OPACITY) },
    { immediateKey: isInCart }
  );

  const lines = (
    <View style={styles.lines}>
      <Animated.Text style={[styles.name, isInCart && styles.inCartName, nameStyle]}>
        {nameLine}
      </Animated.Text>
      {meta === undefined ? null : (
        <Animated.Text style={[styles.meta, metaStyle]}>{meta}</Animated.Text>
      )}
    </View>
  );

  if (!onToggle && !onRemove) {
    return (
      // One element for assistive technologies, as the pressable row is.
      <View
        accessible
        accessibilityLabel={isInCart ? `${label}, ${IN_CART_LABEL}` : label}
        style={styles.row}>
        {lines}
        {/* A tick only where there is one to show: an empty box would ask to be pressed. */}
        {isInCart ? <ShoppingCheckbox checked /> : null}
      </View>
    );
  }

  return (
    // The whole row is the press target: one checkbox for assistive technologies, or one
    // button that only removes when there is nothing to mark.
    <Pressable
      onPress={
        onToggle
          ? () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggle(item.id);
            }
          : undefined
      }
      // A press that became a long press is not reported as a press too, so it never toggles.
      onLongPress={
        onRemove
          ? () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onRemove(item.id);
            }
          : undefined
      }
      accessibilityRole={onToggle ? 'checkbox' : 'button'}
      accessibilityLabel={onToggle || !isInCart ? label : `${label}, ${IN_CART_LABEL}`}
      accessibilityState={onToggle ? { checked: isInCart } : undefined}
      accessibilityHint={onRemove ? 'Mantené presionado para quitarlo de la lista.' : undefined}
      accessibilityActions={onRemove ? ACCESSIBILITY_ACTIONS : undefined}
      onAccessibilityAction={
        onRemove
          ? (event) => {
              if (event.nativeEvent.actionName === REMOVE_ACTION) onRemove(item.id);
            }
          : undefined
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {lines}
      {onToggle || isInCart ? <ShoppingCheckbox checked={isInCart} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inCartName: {
    textDecorationLine: 'line-through',
  },
  lines: {
    flex: 1,
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
  pressed: {
    opacity: 0.6,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
  },
});
