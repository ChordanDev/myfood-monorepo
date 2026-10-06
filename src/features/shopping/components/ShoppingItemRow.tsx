import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { ShoppingListItem } from '@/types/domain';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import { formatItemMetaLine, formatItemNameLine } from '../domain';
import type { BestOffer } from '../types';
import { ShoppingCheckbox } from './ShoppingCheckbox';

export interface ShoppingItemRowProps {
  item: ShoppingListItem;
  bestOffer?: BestOffer;
  onToggle: (itemId: string) => void;
}

const META_OPACITY = 0.6;
const PURCHASED_OPACITY = 0.45;

export function ShoppingItemRow({ item, bestOffer, onToggle }: ShoppingItemRowProps) {
  const { theme } = useRecipeTheme();
  const isPurchased = item.status === 'purchased';
  const nameLine = formatItemNameLine(item);
  const purchasedColor = withOpacity(theme.textBlack, PURCHASED_OPACITY);

  // Marking a row is a state change, not a palette change: it must not crossfade.
  const nameStyle = useAnimatedThemeStyle(
    { color: isPurchased ? purchasedColor : theme.textBlack },
    { immediateKey: isPurchased }
  );
  const metaStyle = useAnimatedThemeStyle(
    { color: isPurchased ? purchasedColor : withOpacity(theme.textBlack, META_OPACITY) },
    { immediateKey: isPurchased }
  );

  return (
    // The whole row is the press target: one checkbox for assistive technologies.
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle(item.id);
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={nameLine}
      accessibilityState={{ checked: isPurchased }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.lines}>
        <Animated.Text style={[styles.name, isPurchased && styles.purchasedName, nameStyle]}>
          {nameLine}
        </Animated.Text>
        <Animated.Text style={[styles.meta, metaStyle]}>
          {formatItemMetaLine(bestOffer)}
        </Animated.Text>
      </View>
      <ShoppingCheckbox checked={isPurchased} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  purchasedName: {
    textDecorationLine: 'line-through',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
  },
});
