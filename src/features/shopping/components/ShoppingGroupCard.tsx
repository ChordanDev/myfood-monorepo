import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { BestOffer, ShoppingGroup } from '../types';
import { getHeaderControlHitSlop, ShoppingCard } from './ShoppingCard';
import { ShoppingCheckbox } from './ShoppingCheckbox';
import { ShoppingItemRow } from './ShoppingItemRow';

const MARK_ALL_LABEL = 'Marcar todos';

// Brings the 24 pt box up to a 44 pt target on the three sides that are free.
const MARK_ALL_HIT_SLOP = getHeaderControlHitSlop(10);

export interface ShoppingGroupCardProps {
  group: ShoppingGroup;
  // Best offer of each row, keyed by item id. A row without an entry has no price.
  bestOffers: Record<string, BestOffer>;
  onToggleItem: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onToggleAll: (groupKey: string) => void;
}

export function ShoppingGroupCard({
  group,
  bestOffers,
  onToggleItem,
  onRemoveItem,
  onToggleAll,
}: ShoppingGroupCardProps) {
  const { theme } = useRecipeTheme();
  const isAllPurchased = group.items.every((item) => item.status === 'purchased');
  const markAllStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <ShoppingCard
      title={group.title}
      headerAction={
        // Label and box are one control.
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggleAll(group.key);
          }}
          hitSlop={MARK_ALL_HIT_SLOP}
          accessibilityRole="checkbox"
          accessibilityLabel={`${MARK_ALL_LABEL}, ${group.title}`}
          accessibilityState={{ checked: isAllPurchased }}
          style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}>
          <Animated.Text style={[styles.markAllLabel, markAllStyle]}>
            {MARK_ALL_LABEL}
          </Animated.Text>
          <ShoppingCheckbox checked={isAllPurchased} />
        </Pressable>
      }>
      {group.items.map((item) => (
        <ShoppingItemRow
          key={item.id}
          item={item}
          bestOffer={bestOffers[item.id]}
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
