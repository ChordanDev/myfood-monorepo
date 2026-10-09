import { Pressable, StyleSheet, Text } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import { formatQuantityMilli, toDisplayCategory } from '../domain';
import type { InventoryItem } from '../types';

interface InventoryRowProps {
  item: InventoryItem;
  onEdit: () => void;
  onDelete: () => void;
}

const ACTION_ICON_SIZE = 18;

export function InventoryRow({ item, onEdit, onDelete }: InventoryRowProps) {
  const { theme } = useRecipeTheme();

  return (
    <ShadowSurface
      style={[
        styles.row,
        { backgroundColor: INVENTORY_CATEGORY_COLORS[toDisplayCategory(item.category)] },
      ]}>
      <Text style={[styles.quantity, { color: theme.textBlack }]}>
        {formatQuantityMilli(item.quantityMilli, item.unit)}
      </Text>
      <Text numberOfLines={1} style={[styles.name, { color: theme.textBlack }]}>
        {item.name}
      </Text>

      <Pressable
        accessibilityLabel={`Editar ${item.name}`}
        accessibilityRole="button"
        onPress={onEdit}
        hitSlop={4}
        style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}>
        <Pencil size={ACTION_ICON_SIZE} color={theme.textBlack} strokeWidth={2} />
      </Pressable>
      <Pressable
        accessibilityLabel={`Borrar ${item.name}`}
        accessibilityRole="button"
        onPress={onDelete}
        hitSlop={4}
        style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}>
        <Trash2 size={ACTION_ICON_SIZE} color={theme.textBlack} strokeWidth={2} />
      </Pressable>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  name: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  quantity: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  row: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    height: 52,
    paddingLeft: 16,
    paddingRight: 8,
  },
});
