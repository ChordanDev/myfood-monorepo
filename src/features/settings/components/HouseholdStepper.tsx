import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { stepHouseholdSize } from '../utils/settingsDraft';
import { formatHouseholdSummary } from '../utils/settingsFormatters';

interface HouseholdStepperProps {
  /** Null while the stored profile has no household size yet. */
  value: number | null;
  onChange: (value: number) => void;
}

export function HouseholdStepper({ value, onChange }: HouseholdStepperProps) {
  const { theme } = useRecipeTheme();
  const decreased = stepHouseholdSize(value, -1);
  const increased = stepHouseholdSize(value, 1);
  // At a bound the step lands on the current value, so the button has nothing to do.
  const canDecrease = value !== null && decreased !== value;
  const canIncrease = increased !== value;

  const buttonColors = {
    backgroundColor: withOpacity(theme.icon, 0.15),
    borderColor: withOpacity(theme.icon, 0.3),
  };

  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel="Quitar una persona"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canDecrease }}
        disabled={!canDecrease}
        onPress={() => onChange(decreased)}
        testID="settings-stepper-decrement"
        style={({ pressed }) => [
          styles.button,
          buttonColors,
          { opacity: !canDecrease ? 0.4 : pressed ? 0.8 : 1 },
        ]}>
        <Text style={[styles.symbol, { color: theme.textLight }]}>−</Text>
      </Pressable>

      <Text
        accessibilityLiveRegion="polite"
        testID="settings-stepper-value"
        style={[styles.value, { color: theme.textLight }]}>
        {formatHouseholdSummary(value)}
      </Text>

      <Pressable
        accessibilityLabel="Agregar una persona"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canIncrease }}
        disabled={!canIncrease}
        onPress={() => onChange(increased)}
        testID="settings-stepper-increment"
        style={({ pressed }) => [
          styles.button,
          buttonColors,
          { opacity: !canIncrease ? 0.4 : pressed ? 0.8 : 1 },
        ]}>
        <Text style={[styles.symbol, { color: theme.textLight }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  symbol: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 22,
    lineHeight: 26,
  },
  value: {
    flex: 1,
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 17,
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
    textAlign: 'center',
  },
});
