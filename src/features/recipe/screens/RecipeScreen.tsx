import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopGradientBackground } from '@/components/TopGradientBackground';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import {
  RecipeHeader,
  RecipeIngredientsCard,
  RecipeNotFound,
  RecipePreparationCard,
} from '../components';
import {
  RECIPE_CONTENT_TOP_PADDING,
  RECIPE_HEADER_CLIP_GAP,
  RECIPE_HEADER_HEIGHT,
  RECIPE_HEADER_MIN_TOP,
  RECIPE_SCREEN_SIDE_PADDING,
  RECIPE_SECTION_GAP,
} from '../constants';
import { useActivateRecipePalette } from '../hooks/useActivateRecipePalette';
import { useRecipeScreen } from '../hooks/useRecipeScreen';

const CONTENT_BOTTOM_PADDING = 24;

export function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const {
    recipe,
    rows,
    isFavorite,
    canMarkAsCooked,
    handleBack,
    handleToggleFavorite,
    handleMarkAsCooked,
    handleRequestIngredient,
  } = useRecipeScreen();

  useActivateRecipePalette(recipe?.theme);

  const headerTop = Math.max(insets.top, RECIPE_HEADER_MIN_TOP);

  if (!recipe) return <RecipeNotFound top={headerTop} onBack={handleBack} />;

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <TopGradientBackground />

      <ScrollView
        testID="recipe-scroll"
        style={[
          styles.scroll,
          { marginTop: headerTop + RECIPE_HEADER_HEIGHT + RECIPE_HEADER_CLIP_GAP },
        ]}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + CONTENT_BOTTOM_PADDING },
        ]}
        // The paddings already include the safe area; iOS must not add it a second time.
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <RecipeIngredientsCard rows={rows} onRequestIngredient={handleRequestIngredient} />
        <RecipePreparationCard steps={recipe.steps} />
      </ScrollView>

      <RecipeHeader
        top={headerTop}
        title={recipe.name}
        isFavorite={isFavorite}
        canMarkAsCooked={canMarkAsCooked}
        onBack={handleBack}
        onToggleFavorite={handleToggleFavorite}
        onMarkAsCooked={handleMarkAsCooked}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: RECIPE_SECTION_GAP,
    paddingHorizontal: RECIPE_SCREEN_SIDE_PADDING,
    paddingTop: RECIPE_CONTENT_TOP_PADDING,
  },
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
});
