// Public surface of the favorites feature. Internal modules import each other by relative path.
export { addFavorite, listFavorites, removeFavorite } from './api/favoritesApi';
export { selectIsFavorite, useFavoritesStore } from './store';
export type { FavoriteSummary } from './types';
