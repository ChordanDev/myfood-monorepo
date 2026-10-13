import { useCallback, useEffect, useState } from 'react';
import { useFavoritesStore, type FavoriteSummary } from '@/features/favorites';

export interface PlanningFavorites {
  /** The User's Favorite recipes, as the favorites store holds them. */
  favorites: FavoriteSummary[];
  /** The ids the User preselected, in the order they picked them. */
  selectedRecipeIds: string[];
  /** Selects the favorite with that id, or deselects it when it was selected. */
  toggle: (recipeId: string) => void;
}

/**
 * The Favorite recipes the User can preselect for the plan they are about to start. The store is
 * read from the server when the planner opens, as the persisted cache can be empty or stale; a
 * failed read leaves the cache as it was. A favorite that leaves the store is no longer selected.
 */
export function usePlanningFavorites(): PlanningFavorites {
  const favorites = useFavoritesStore((state) => state.favorites);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    // Nothing to report: the cached list is drawn whether or not the server answers.
    useFavoritesStore
      .getState()
      .load()
      .catch(() => {});
  }, []);

  // Adjusted while rendering, not in an effect, so a removed favorite is never sent and does not
  // come back selected if the User favorites it again.
  const stillFavorite = selected.filter((id) => favorites.some((f) => f.recipeId === id));
  if (stillFavorite.length !== selected.length) setSelected(stillFavorite);

  const toggle = useCallback(
    (recipeId: string) =>
      setSelected((current) =>
        current.includes(recipeId)
          ? current.filter((id) => id !== recipeId)
          : useFavoritesStore.getState().isFavorite(recipeId)
            ? [...current, recipeId]
            : current
      ),
    []
  );

  return { favorites, selectedRecipeIds: stillFavorite, toggle };
}
