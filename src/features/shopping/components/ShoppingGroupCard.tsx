import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { BestOffer, ShoppingGroup } from '../types';
import { ShoppingCheckbox } from './ShoppingCheckbox';
import { ShoppingItemRow } from './ShoppingItemRow';

const MARK_ALL_LABEL = 'Marcar todos';

export interface ShoppingGroupCardProps {
  group: ShoppingGroup;
  // Best offer of each row, keyed by item id. A row without an entry has no price.
  bestOffers: Record<string, BestOffer>;
  onToggleItem: (itemId: string) => void;
  onToggleAll: (groupKey: string) => void;
}

export function ShoppingGroupCard({
  group,
  bestOffers,
  onToggleItem,
  onToggleAll,
}: ShoppingGroupCardProps) {
  const { theme } = useRecipeTheme();
  const isAllPurchased = group.items.every((item) => item.status === 'purchased');
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const markAllStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <View style={styles.header}>
          <Animated.Text accessibilityRole="header" style={[styles.title, titleStyle]}>
            {group.title}
          </Animated.Text>
          {/* Label and box are one control; the slop brings the 24 pt box up to a 44 pt target. */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggleAll(group.key);
            }}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityLabel={`${MARK_ALL_LABEL}, ${group.title}`}
            accessibilityState={{ checked: isAllPurchased }}
            style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}>
            <Animated.Text style={[styles.markAllLabel, markAllStyle]}>
              {MARK_ALL_LABEL}
            </Animated.Text>
            <ShoppingCheckbox checked={isAllPurchased} />
          </Pressable>
        </View>
        {group.items.map((item) => (
          <ShoppingItemRow
            key={item.id}
            item={item}
            bestOffer={bestOffers[item.id]}
            onToggle={onToggleItem}
          />
        ))}
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
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
  shadowSurface: {
    borderRadius: 24,
  },
  surface: {
    borderRadius: 21,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 23,
  },
});
