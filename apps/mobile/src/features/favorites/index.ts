// Public surface of the favorites feature. Internal modules import each other by relative path.
export { addFavorite, listFavorites, removeFavorite } from './api/favoritesApi';
export { useClearFavoritesOnSignOut } from './hooks/useClearFavoritesOnSignOut';
export { favoriteSummaryFromRecipe } from './domain/favoriteFormat';
export { selectIsFavorite, useFavoritesStore } from './store';
export type { FavoriteSummary } from './types';
