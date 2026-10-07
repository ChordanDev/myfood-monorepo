import { StyleSheet, Text, View } from 'react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import {
  countMissing,
  formatMissingSummary,
  type RecipeIngredientRow,
} from '../domain/recipeIngredients';
import { RecipeIngredientItem } from './RecipeIngredientItem';

interface RecipeIngredientsCardProps {
  rows: RecipeIngredientRow[];
  onRequestIngredient: (row: RecipeIngredientRow) => void;
}

export function RecipeIngredientsCard({ rows, onRequestIngredient }: RecipeIngredientsCardProps) {
  const { theme } = useRecipeTheme();
  const missingSummary = formatMissingSummary(countMissing(rows));

  return (
    <ShadowSurface style={[styles.card, { backgroundColor: theme.colorLight }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.textDark }]}>
          Ingredientes
        </Text>
        {missingSummary ? (
          <Text
            testID="recipe-ingredients-missing-summary"
            style={[styles.counter, { color: withOpacity(theme.textBlack, 0.6) }]}>
            {missingSummary}
          </Text>
        ) : null}
      </View>
      {rows.map((row, index) => (
        <RecipeIngredientItem
          key={`${row.ingredientId}-${index}`}
          row={row}
          onRequest={onRequestIngredient}
        />
      ))}
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderCurve: 'continuous',
    borderRadius: 21,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  counter: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 23,
  },
});
