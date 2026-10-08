import { StyleSheet, Text, View } from 'react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import type { RecipeFact } from '../domain/recipeFormat';
import {
  countMissing,
  formatMissingSummary,
  type RecipeIngredientRow,
} from '../domain/recipeIngredients';
import { RecipeIngredientItem } from './RecipeIngredientItem';

interface RecipeIngredientsCardProps {
  rows: RecipeIngredientRow[];
  /** Servings, duration and cost, each only when the recipe knows it; drawn under the rows. */
  facts: RecipeFact[];
  /** Without it no row offers to send its ingredient to the shopping list. */
  onRequestIngredient?: (row: RecipeIngredientRow) => void;
}

export function RecipeIngredientsCard({
  rows,
  facts,
  onRequestIngredient,
}: RecipeIngredientsCardProps) {
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
      {facts.map((fact) => (
        <View key={fact.id} testID={`recipe-fact-${fact.id}`} style={styles.fact}>
          <Text style={[styles.factLabel, { color: withOpacity(theme.textBlack, 0.6) }]}>
            {fact.label}
          </Text>
          <Text style={[styles.factValue, { color: theme.textBlack }]}>{fact.value}</Text>
        </View>
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
  fact: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 40,
  },
  factLabel: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  factValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
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
