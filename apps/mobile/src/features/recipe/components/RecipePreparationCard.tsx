import { StyleSheet, Text, View } from 'react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { RecipeStep } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface RecipePreparationCardProps {
  steps: RecipeStep[];
}

function formatStepCount(count: number): string {
  return count === 1 ? '1 paso' : `${count} pasos`;
}

export function RecipePreparationCard({ steps }: RecipePreparationCardProps) {
  const { theme } = useRecipeTheme();
  const orderedSteps = [...steps].sort((first, second) => first.order - second.order);

  return (
    <ShadowSurface style={[styles.card, { backgroundColor: theme.colorDark }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
          Preparación
        </Text>
        <Text style={[styles.counter, { color: theme.icon }]}>{formatStepCount(steps.length)}</Text>
      </View>
      {orderedSteps.map((step) => (
        <View key={step.order} testID={`recipe-step-${step.order}`} style={styles.step}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: withOpacity(theme.icon, 0.15),
                borderColor: withOpacity(theme.icon, 0.3),
              },
            ]}>
            <Text style={[styles.badgeLabel, { color: theme.icon }]}>{step.order}</Text>
          </View>
          <Text style={[styles.instruction, { color: theme.textLight }]}>{step.instruction}</Text>
        </View>
      ))}
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  badgeLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  card: {
    borderCurve: 'continuous',
    borderRadius: 21,
    gap: 12,
    padding: 16,
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
  },
  instruction: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    paddingTop: 3,
  },
  step: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  title: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 23,
  },
});
