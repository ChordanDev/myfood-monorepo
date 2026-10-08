import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { ShoppingGroup } from '../types';
import { getHeaderControlHitSlop, ShoppingCard } from './ShoppingCard';
import { ShoppingCheckbox } from './ShoppingCheckbox';
import { ShoppingItemRow } from './ShoppingItemRow';

const MARK_ALL_LABEL = 'Marcar todos';

// Brings the 24 pt box up to a 44 pt target on the three sides that are free.
const MARK_ALL_HIT_SLOP = getHeaderControlHitSlop(10);

export interface ShoppingGroupCardProps {
  group: ShoppingGroup;
  // Second line of each row, keyed by item id. A row without an entry is one line.
  metaLines?: Record<string, string>;
  // Without the three handlers the card is read-only: it has no "Marcar todos" and no row of
  // it can be pressed.
  onToggleItem?: (itemId: string) => void;
  onRemoveItem?: (itemId: string) => void;
  onToggleAll?: (groupKey: string) => void;
}

export function ShoppingGroupCard({
  group,
  metaLines = {},
  onToggleItem,
  onRemoveItem,
  onToggleAll,
}: ShoppingGroupCardProps) {
  const { theme } = useRecipeTheme();
  const isAllInCart = group.items.every((item) => item.status === 'in_cart');
  const markAllStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <ShoppingCard
      title={group.title}
      headerAction={
        onToggleAll ? (
          // Label and box are one control.
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggleAll(group.key);
            }}
            hitSlop={MARK_ALL_HIT_SLOP}
            accessibilityRole="checkbox"
            accessibilityLabel={`${MARK_ALL_LABEL}, ${group.title}`}
            accessibilityState={{ checked: isAllInCart }}
            style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}>
            <Animated.Text style={[styles.markAllLabel, markAllStyle]}>
              {MARK_ALL_LABEL}
            </Animated.Text>
            <ShoppingCheckbox checked={isAllInCart} />
          </Pressable>
        ) : undefined
      }>
      {group.items.map((item) => (
        <ShoppingItemRow
          key={item.id}
          item={item}
          meta={metaLines[item.id]}
          onToggle={onToggleItem}
          onRemove={onRemoveItem}
        />
      ))}
    </ShoppingCard>
  );
}

const styles = StyleSheet.create({
  markAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  markAllLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.6,
  },
});
