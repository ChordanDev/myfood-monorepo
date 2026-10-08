import { RecipeStatusFrame, RecipeStatusMessage } from './RecipeStatusFrame';

interface RecipeForbiddenProps {
  /** Distance of the back button from the top of the screen. */
  top: number;
  onBack: () => void;
}

/** Shown when the server refuses the recipe to the Account: trying again would not change it. */
export function RecipeForbidden({ top, onBack }: RecipeForbiddenProps) {
  return (
    <RecipeStatusFrame top={top} onBack={onBack}>
      <RecipeStatusMessage testID="recipe-forbidden">
        Tu cuenta no tiene acceso a esta receta por ahora
      </RecipeStatusMessage>
    </RecipeStatusFrame>
  );
}
