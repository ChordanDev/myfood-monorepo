import { RecipeStatusFrame, RecipeStatusMessage } from './RecipeStatusFrame';

interface RecipeNotFoundProps {
  /** Distance of the back button from the top of the screen. */
  top: number;
  onBack: () => void;
}

/** Shown when the route points at a recipe that neither the plan nor the server has. */
export function RecipeNotFound({ top, onBack }: RecipeNotFoundProps) {
  return (
    <RecipeStatusFrame top={top} onBack={onBack}>
      <RecipeStatusMessage testID="recipe-not-found">
        No encontramos esta receta
      </RecipeStatusMessage>
    </RecipeStatusFrame>
  );
}
