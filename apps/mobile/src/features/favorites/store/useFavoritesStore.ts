import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { addFavorite, listFavorites, removeFavorite } from '../api/favoritesApi';
import type { FavoriteSummary } from '../types/favorites';

interface FavoritesState {
  // Ordered by name, like the API lists them.
  favorites: FavoriteSummary[];
  isFavorite: (recipeId: string) => boolean;
  /** Replaces the favorites with the server's. Rejects when the request fails. */
  load: () => Promise<void>;
  /**
   * Flips the favorite at once and tells the server. Resolves `true` when the server took it
   * and `false` when it was refused (the change is then taken back). Never rejects.
   */
  toggle: (recipe: FavoriteSummary) => Promise<boolean>;
  clear: () => void;
}

// What a recipe was on the server before the toggles still in flight, so a refusal can put it
// back: the state before the latest toggle is not it when an earlier toggle failed.
interface PendingToggles {
  confirmed: FavoriteSummary | null;
  // Requests of one recipe go out in order, so the server ends on the last intent.
  tail: Promise<unknown>;
  count: number;
  latest: number;
}

// Kept out of the store so none of it is persisted.
const pendingByRecipeId = new Map<string, PendingToggles>();
let inFlightLoad: Promise<void> | null = null;

// Bumped by `clear()`: an answer that comes back after it must not write into a store that was
// emptied since (a sign-out, for one).
let storeGeneration = 0;

function byName(a: FavoriteSummary, b: FavoriteSummary) {
  return a.name.localeCompare(b.name);
}

function withFavorite(favorites: FavoriteSummary[], favorite: FavoriteSummary) {
  return [...favorites.filter((f) => f.recipeId !== favorite.recipeId), favorite].sort(byName);
}

function withoutFavorite(favorites: FavoriteSummary[], recipeId: string) {
  return favorites.filter((f) => f.recipeId !== recipeId);
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      isFavorite: (recipeId) => get().favorites.some((f) => f.recipeId === recipeId),
      load: () => {
        if (inFlightLoad) return inFlightLoad;

        const generation = storeGeneration;
        const load: Promise<void> = listFavorites()
          .then((server) => {
            if (generation !== storeGeneration) return;

            // A recipe with a toggle in flight keeps what the User sees now: the list may
            // have been read before that toggle reached the server.
            set((state) => ({
              favorites: [
                ...server.filter((f) => !pendingByRecipeId.has(f.recipeId)),
                ...state.favorites.filter((f) => pendingByRecipeId.has(f.recipeId)),
              ].sort(byName),
            }));
          })
          .finally(() => {
            if (inFlightLoad === load) inFlightLoad = null;
          });

        inFlightLoad = load;
        return load;
      },
      toggle: (recipe) => {
        const { recipeId } = recipe;
        const generation = storeGeneration;
        const wasFavorite = get().isFavorite(recipeId);

        let pending = pendingByRecipeId.get(recipeId);
        if (!pending) {
          pending = {
            confirmed: get().favorites.find((f) => f.recipeId === recipeId) ?? null,
            tail: Promise.resolve(),
            count: 0,
            latest: 0,
          };
          pendingByRecipeId.set(recipeId, pending);
        }
        const entry = pending;
        entry.count += 1;
        entry.latest += 1;
        const mine = entry.latest;

        set((state) => ({
          favorites: wasFavorite
            ? withoutFavorite(state.favorites, recipeId)
            : withFavorite(state.favorites, recipe),
        }));

        const execute = async (): Promise<boolean> => {
          try {
            const saved = wasFavorite ? null : await addFavorite(recipeId);
            if (wasFavorite) await removeFavorite(recipeId);

            if (generation !== storeGeneration) return true;
            entry.confirmed = saved;
            // The server's summary is the truth, unless a newer toggle already moved on.
            if (saved && mine === entry.latest) {
              set((state) => ({ favorites: withFavorite(state.favorites, saved) }));
            }
            return true;
          } catch {
            // A newer toggle is queued behind this one and will settle the recipe itself.
            if (generation === storeGeneration && mine === entry.latest) {
              const { confirmed } = entry;
              set((state) => ({
                favorites: confirmed
                  ? withFavorite(state.favorites, confirmed)
                  : withoutFavorite(state.favorites, recipeId),
              }));
            }
            return false;
          } finally {
            entry.count -= 1;
            if (entry.count === 0 && pendingByRecipeId.get(recipeId) === entry) {
              pendingByRecipeId.delete(recipeId);
            }
          }
        };

        // The first request of a recipe goes out right away; later ones wait their turn.
        const run = entry.count === 1 ? execute() : entry.tail.then(execute);
        entry.tail = run;
        return run;
      },
      clear: () => {
        storeGeneration += 1;
        pendingByRecipeId.clear();
        inFlightLoad = null;
        set({ favorites: [] });
      },
    }),
    {
      name: 'favorites-storage',
      storage: createJSONStorage(() => safeAsyncStorage),
      partialize: ({ favorites }) => ({ favorites }),
    }
  )
);

/** Selector for a component: re-renders only when this recipe's favorite state flips. */
export const selectIsFavorite = (recipeId: string) => (state: FavoritesState) =>
  state.favorites.some((f) => f.recipeId === recipeId);
