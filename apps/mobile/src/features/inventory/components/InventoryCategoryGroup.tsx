import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { INGREDIENT_CATEGORY_LABELS } from '@/constants/ingredientCategories';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { IngredientCategory } from '@/types/domain';
import { withOpacity } from '@/utils/colors';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import type { InventoryItem } from '../types';
import { InventoryRow } from './InventoryRow';

interface InventoryCategoryGroupProps {
  category: IngredientCategory;
  items: InventoryItem[];
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (item: InventoryItem) => void;
}

const CHEVRON_SIZE = 18;

export function InventoryCategoryGroup({
  category,
  items,
  onEditItem,
  onDeleteItem,
}: InventoryCategoryGroupProps) {
  const { theme } = useRecipeTheme();
  const [expanded, setExpanded] = useState(true);
  const label = INGREDIENT_CATEGORY_LABELS[category];
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <View style={[styles.group, expanded ? styles.groupExpanded : styles.groupCollapsed]}>
      <Pressable
        accessibilityLabel={`${label}, ${items.length} ${items.length === 1 ? 'producto' : 'productos'}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        hitSlop={8}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}>
        <Text style={[styles.label, { color: theme.textDark }]}>{label}</Text>
        <Text style={[styles.count, { color: withOpacity(theme.textDark, 0.6) }]}>
          {items.length}
        </Text>
        <View style={styles.spacer} />
        <Chevron size={CHEVRON_SIZE} color={theme.textDark} strokeWidth={2.5} />
      </Pressable>

      {expanded ? (
        items.map((item) => (
          <InventoryRow
            key={item.id}
            item={item}
            onEdit={() => onEditItem(item)}
            onDelete={() => onDeleteItem(item)}
          />
        ))
      ) : (
        // Edge of the hidden rows peeking out from under the header.
        <View style={[styles.peek, { backgroundColor: INVENTORY_CATEGORY_COLORS[category] }]} />
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
