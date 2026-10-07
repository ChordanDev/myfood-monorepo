import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { ManualShoppingListItem } from '../types';
import { getHeaderControlHitSlop, ShoppingCard } from './ShoppingCard';
import { ShoppingItemRow } from './ShoppingItemRow';

const ADD_ICON_SIZE = 24;
// The slop cannot grow downwards, where the first row starts, so the 44 pt target is
// completed upwards, inside the padding of the card.
const ADD_HIT_SLOP = getHeaderControlHitSlop(14);

export interface ShoppingManualCardProps {
  // Manual items still on the list; the removed ones are not passed.
  items: ManualShoppingListItem[];
  onToggleItem: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onAdd: () => void;
}

// Always on screen, even with no items: its plus button is the way to add one.
export function ShoppingManualCard({
  items,
  onToggleItem,
  onRemoveItem,
  onAdd,
}: ShoppingManualCardProps) {
  const { theme } = useRecipeTheme();
  const hintStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <ShoppingCard
      title="Agregados a mano"
      headerAction={
        <Pressable
          onPress={onAdd}
          hitSlop={ADD_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Agregar a la lista"
          style={({ pressed }) => pressed && styles.pressed}>
          <Plus size={ADD_ICON_SIZE} color={theme.textDark} strokeWidth={2.5} />
        </Pressable>
      }>
      {items.length > 0 ? (
        items.map((item) => (
          // A manual item has no offer: the row reads "Sin precio".
          <ShoppingItemRow
            key={item.id}
            item={item}
            onToggle={onToggleItem}
            onRemove={onRemoveItem}
          />
        ))
      ) : (
        <Animated.Text style={[styles.hint, hintStyle]}>Todavía no agregaste nada.</Animated.Text>
      )}
    </ShoppingCard>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.6,
  },
});
