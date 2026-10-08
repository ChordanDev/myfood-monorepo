import { Pressable, StyleSheet, Text } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RecipeStatusFrame, RecipeStatusMessage } from './RecipeStatusFrame';

interface RecipeLoadErrorProps {
  /** Distance of the back button from the top of the screen. */
  top: number;
  onBack: () => void;
  onRetry: () => void;
}

// The chip is 40pt tall: 2pt on each side reaches a 44pt target.
const HIT_SLOP = { top: 2, bottom: 2 };

/** Shown when the recipe could not be loaded for a reason that trying again may fix. */
export function RecipeLoadError({ top, onBack, onRetry }: RecipeLoadErrorProps) {
  const { theme } = useRecipeTheme();

  return (
    <RecipeStatusFrame top={top} onBack={onBack}>
      <RecipeStatusMessage testID="recipe-load-error">
        No pudimos cargar esta receta
      </RecipeStatusMessage>
      <Pressable
        testID="recipe-load-retry"
        accessibilityRole="button"
        hitSlop={HIT_SLOP}
        onPress={onRetry}
        style={[styles.retry, { backgroundColor: theme.colorDark }]}>
        <Text style={[styles.retryLabel, { color: theme.textLight }]}>Reintentar</Text>
      </Pressable>
    </RecipeStatusFrame>
  );
}

const styles = StyleSheet.create({
  retry: {
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  retryLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
  },
});
