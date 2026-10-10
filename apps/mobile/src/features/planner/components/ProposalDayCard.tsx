import { StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import {
  formatCostCents,
  formatMealMacros,
  formatProposalDay,
  MEAL_SLOT_LABELS,
} from '../domain/proposalFormat';
import type { PlannerDay } from '../types/planningEvents';

interface ProposalDayCardProps {
  day: PlannerDay;
}

/** One day of the proposal: its meals with their macros, and what the day costs. */
export function ProposalDayCard({ day }: ProposalDayCardProps) {
  const { theme } = useRecipeTheme();

  return (
    <View
      accessible
      testID={`planner-proposal-day-${day.date}`}
      style={[styles.card, { backgroundColor: theme.colorLight }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textBlack }]}>
          {formatProposalDay(day.date)}
        </Text>
        <Text style={[styles.cost, { color: theme.textDark }]}>
          {formatCostCents(day.costCents)}
        </Text>
      </View>
      {day.meals.map((meal) => (
        <View key={`${meal.slot}-${meal.recipeId}`} style={styles.meal}>
          <Text style={[styles.slot, { color: theme.textDark }]}>
            {MEAL_SLOT_LABELS[meal.slot]}
          </Text>
          <Text style={[styles.recipe, { color: theme.textBlack }]}>{meal.recipeName}</Text>
          <Text style={[styles.macros, { color: theme.textDark }]}>
            {formatMealMacros(meal.macros)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 21,
    gap: 14,
    padding: 17.5,
  },
  cost: {
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macros: {
    fontSize: 13,
    fontWeight: '500',
  },
  meal: {
    gap: 2,
  },
  recipe: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  slot: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
});
