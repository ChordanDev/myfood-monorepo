import { StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RECIPE_SCREEN_SIDE_PADDING } from '../constants';
import { RecipeHeaderButton } from './RecipeHeaderButton';
import { RecipeTopGradient } from './RecipeTopGradient';

interface RecipeNotFoundProps {
  /** Distance of the back button from the top of the screen. */
  top: number;
  onBack: () => void;
}

/** Shown when the route points at a recipe the plan no longer has. */
export function RecipeNotFound({ top, onBack }: RecipeNotFoundProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <RecipeTopGradient />
      <Text testID="recipe-not-found" style={[styles.message, { color: theme.textDark }]}>
        No encontramos esta receta
      </Text>
      <View style={[styles.back, { top }]}>
        <RecipeHeaderButton
          testID="recipe-header-back"
          accessibilityLabel="Volver"
          onPress={onBack}>
          <ArrowLeft size={24} color={theme.primaryAccent} strokeWidth={2.5} />
        </RecipeHeaderButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    left: RECIPE_SCREEN_SIDE_PADDING,
    position: 'absolute',
  },
  message: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
