import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import { formatQuantityMilli, toDisplayCategory } from '../domain';
import type { InventoryItem } from '../types';

interface InventoryRowProps {
  item: InventoryItem;
  onEdit: () => void;
}

const ACTION_ICON_SIZE = 18;

export function InventoryRow({ item, onEdit }: InventoryRowProps) {
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
      <View style={styles.description}>
        <Text numberOfLines={1} style={[styles.name, { color: theme.textBlack }]}>
          {item.name}
        </Text>
        {item.notes ? (
          <Text
            numberOfLines={1}
            style={[styles.notes, { color: withOpacity(theme.textBlack, 0.6) }]}>
            {item.notes}
          </Text>
        ) : null}
      </View>

      {item.isLeftover ? (
        <View style={[styles.leftoverPill, { backgroundColor: withOpacity(theme.textBlack, 0.1) }]}>
          <Text style={[styles.leftoverLabel, { color: withOpacity(theme.textBlack, 0.6) }]}>
            Sobra
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel={`Editar ${item.name}`}
        accessibilityRole="button"
        onPress={onEdit}
        hitSlop={4}
        style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}>
        <Pencil size={ACTION_ICON_SIZE} color={theme.textBlack} strokeWidth={2} />
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
  description: {
    flex: 1,
  },
  leftoverLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.3,
    lineHeight: 14,
  },
  leftoverPill: {
    borderRadius: 9999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  name: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  notes: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
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
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
});
