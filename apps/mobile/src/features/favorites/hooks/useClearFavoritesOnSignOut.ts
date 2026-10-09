import { useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth';
import { useFavoritesStore, whenFavoritesHydrated } from '../store';

/**
 * The favorites are kept on the device between launches together with the User they were read
 * for, so they must not outlive that User: when the signed-in User goes away, or the one who
 * signs in is not the owner of the cache (even on the first sign-in of a launch), it is emptied.
 */
export function useClearFavoritesOnSignOut() {
  const userId = useAuth().user?.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserIdRef.current;
    previousUserIdRef.current = userId;

    if (previous !== null && userId === null) {
      useFavoritesStore.getState().clear();
      useFavoritesStore.getState().setOwnerUserId(null);
      return;
    }
    if (userId === null) return;

    // The owner is read from the device: wait until it was.
    return whenFavoritesHydrated(() => {
      const store = useFavoritesStore.getState();
      if (store.ownerUserId !== userId) store.clear();
      store.setOwnerUserId(userId);
    });
  }, [userId]);
}
