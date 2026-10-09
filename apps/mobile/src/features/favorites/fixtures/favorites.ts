import type { FavoriteSummary } from '../types/favorites';
import favorites from './favorites.json';

// Every field of the frozen payload is checked against `FavoriteSummary` by the compiler.
export function fixtureFavorites(): FavoriteSummary[] {
  return favorites.data.map((favorite) => ({ ...favorite }));
}
