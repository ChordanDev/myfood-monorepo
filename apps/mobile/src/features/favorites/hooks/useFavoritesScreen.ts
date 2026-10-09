import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useFavoritesStore } from '../store';
import type { FavoriteSummary } from '../types/favorites';

type LoadStatus = 'loading' | 'ready' | 'failed';

/**
 * Reads the favorites from the server when the screen opens and owns its handlers. The list
 * shown is the store's, so an unfavorite is gone at once and comes back if the server refuses.
 */
export function useFavoritesScreen() {
  const router = useRouter();
  const favorites = useFavoritesStore((state) => state.favorites);
  const toggle = useFavoritesStore((state) => state.toggle);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // An answer that arrives after the screen unmounted is dropped.
    let isCurrent = true;

    useFavoritesStore
      .getState()
      .load()
      .then(
        () => {
          if (isCurrent) setStatus('ready');
        },
        () => {
          if (isCurrent) setStatus('failed');
        }
      );

    return () => {
      isCurrent = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((current) => current + 1);
  }, []);

  const handleBack = useCallback(() => router.back(), [router]);

  const handleOpenRecipe = useCallback(
    (favorite: FavoriteSummary) =>
      router.push({ pathname: '/recipe/[id]', params: { id: favorite.recipeId } }),
    [router]
  );

  const handleUnfavorite = useCallback((favorite: FavoriteSummary) => toggle(favorite), [toggle]);

  return {
    favorites,
    // A cached list is drawn while the server is asked again; the spinner is for no list at all.
    isLoading: status === 'loading' && favorites.length === 0,
    isEmpty: status === 'ready' && favorites.length === 0,
    hasFailed: status === 'failed',
    retry,
    handleBack,
    handleOpenRecipe,
    handleUnfavorite,
  };
}
