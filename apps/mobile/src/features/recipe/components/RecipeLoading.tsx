import { ActivityIndicator } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RecipeStatusFrame } from './RecipeStatusFrame';

interface RecipeLoadingProps {
  /** Distance of the back button from the top of the screen. */
  top: number;
  onBack: () => void;
}

/** Shown while the recipe is on its way from the server. */
export function RecipeLoading({ top, onBack }: RecipeLoadingProps) {
  const { theme } = useRecipeTheme();

  return (
    <RecipeStatusFrame top={top} onBack={onBack}>
      <ActivityIndicator
        testID="recipe-loading"
        accessibilityLabel="Cargando la receta"
        color={theme.textDark}
      />
    </RecipeStatusFrame>
  );
}
