import { useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth';
import { useFavoritesStore } from '../store';

/**
 * The favorites are kept on the device between launches, so they must not outlive the User they
 * were read for: when the signed-in User goes away, or becomes another one, the cache is emptied.
 * A cold start with nobody signed in yet keeps it, so the first paint of the same User is not lost.
 */
export function useClearFavoritesOnSignOut() {
  const userId = useAuth().user?.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserIdRef.current;
    previousUserIdRef.current = userId;

    if (previous !== null && previous !== userId) {
      useFavoritesStore.getState().clear();
    }
  }, [userId]);
}
