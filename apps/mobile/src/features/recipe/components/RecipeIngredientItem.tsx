import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import type { RecipeIngredientRow, RecipeIngredientStatus } from '../domain/recipeIngredients';

interface RecipeIngredientItemProps {
  row: RecipeIngredientRow;
  /** Called when the user asks to send a missing ingredient to the shopping list. */
  onRequest: (row: RecipeIngredientRow) => void;
}

const STATUS_LABEL: Record<RecipeIngredientStatus, string> = {
  in_stock: 'En stock',
  missing: 'Falta · agregar',
  listed: 'En la lista',
};

// An ingredient outside the local catalog cannot be put on the shopping list, which is built
// from that catalog: it only reads as missing, with nothing to press.
const UNLISTABLE_MISSING_LABEL = 'Falta';

// The row is 40pt tall and rows touch each other, so 2pt on each side reaches a 44pt target.
const ADD_HIT_SLOP = { top: 2, bottom: 2, left: 12, right: 12 };

export function RecipeIngredientItem({ row, onRequest }: RecipeIngredientItemProps) {
  const { theme } = useRecipeTheme();
  const isMissing = row.status === 'missing';
  // A row has a unit only when the local catalog knows its ingredient.
  const canAdd = isMissing && row.unit !== null;
  const statusLabel = isMissing && !canAdd ? UNLISTABLE_MISSING_LABEL : STATUS_LABEL[row.status];

  return (
    <View testID={`recipe-ingredient-row-${row.ingredientId}`} style={styles.row}>
      <Text style={[styles.quantity, { color: theme.textBlack }]}>{row.quantityLabel}</Text>
      <Text style={[styles.name, { color: theme.textBlack }]}>{row.name}</Text>
      {canAdd ? (
        <Pressable
          testID={`recipe-ingredient-add-${row.ingredientId}`}
          accessibilityRole="button"
          accessibilityLabel={`Falta ${row.name}. Agregar a compras`}
          hitSlop={ADD_HIT_SLOP}
          onPress={() => onRequest(row)}
          style={styles.addButton}>
          <Text style={[styles.status, { color: theme.alert }]}>{statusLabel}</Text>
        </Pressable>
      ) : (
        <Text
          style={[
            styles.status,
            { color: isMissing ? theme.alert : withOpacity(theme.textBlack, 0.6) },
          ]}>
          {statusLabel}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignSelf: 'stretch',
    justifyContent: 'center',
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
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
    width: 62,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 40,
  },
  status: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.3,
    lineHeight: 16,
  },
});
