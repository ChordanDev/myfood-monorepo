import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import { toDisplayCategory } from '../domain';
import type { InventoryItem } from '../types';
import { InventoryRow } from './InventoryRow';

interface InventorySectionProps {
  title: string;
  // Never empty: the screen leaves out a section without items
  items: InventoryItem[];
  onEditItem: (item: InventoryItem) => void;
}

const CHEVRON_SIZE = 18;

export function InventorySection({ title, items, onEditItem }: InventorySectionProps) {
  const { theme } = useRecipeTheme();
  const [expanded, setExpanded] = useState(true);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const peekColor = INVENTORY_CATEGORY_COLORS[toDisplayCategory(items[0].category)];

  return (
    <View style={[styles.group, expanded ? styles.groupExpanded : styles.groupCollapsed]}>
      <Pressable
        accessibilityLabel={`${title}, ${items.length} ${items.length === 1 ? 'producto' : 'productos'}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        hitSlop={8}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}>
        <Text style={[styles.label, { color: theme.textDark }]}>{title}</Text>
        <Text style={[styles.count, { color: withOpacity(theme.textDark, 0.6) }]}>
          {items.length}
        </Text>
        <View style={styles.spacer} />
        <Chevron size={CHEVRON_SIZE} color={theme.textDark} strokeWidth={2.5} />
      </Pressable>

      {expanded ? (
        items.map((item) => (
          <InventoryRow key={item.id} item={item} onEdit={() => onEditItem(item)} />
        ))
      ) : (
        // Edge of the hidden rows peeking out from under the header, in the color of the first.
        <View style={[styles.peek, { backgroundColor: peekColor }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  count: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  group: {
    gap: 10,
  },
  // Extra space before the next header, on top of the gap between groups.
  groupCollapsed: {
    paddingBottom: 2,
  },
  groupExpanded: {
    paddingBottom: 8,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
  label: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  peek: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    height: 6,
    marginHorizontal: 24,
    marginTop: -6,
    opacity: 0.8,
  },
  spacer: {
    flex: 1,
  },
});
