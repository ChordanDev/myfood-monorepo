import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type { FavoriteSummary } from '../types/favorites';

const FAVORITES_PATH = '/api/me/favorites';

/** Lists the favorites of the signed-in User, ordered by name. */
export async function listFavorites(options?: RequestOptions): Promise<FavoriteSummary[]> {
  const response = await apiClient.get<unknown>(FAVORITES_PATH, {
    ...options,
    auth: true,
    retry: options?.retry ?? true,
  });

  const data = unwrapData(response);
  if (!Array.isArray(data) || !data.every(isFavoriteSummary)) {
    throw malformed();
  }

  return data;
}

/** Favorites a recipe. Idempotent on the server: a recipe already favorited answers the same. */
export async function addFavorite(
  recipeId: string,
  options?: RequestOptions
): Promise<FavoriteSummary> {
  const response = await apiClient.post<unknown>(
    FAVORITES_PATH,
    { recipeId },
    { ...options, auth: true, retry: options?.retry ?? true }
  );

  const data = unwrapData(response);
  if (!isFavoriteSummary(data)) throw malformed();

  return data;
}

/** Unfavorites a recipe. The server answers 204 with no body, even if it was not a favorite. */
export async function removeFavorite(recipeId: string, options?: RequestOptions): Promise<void> {
  await apiClient.delete<unknown>(`${FAVORITES_PATH}/${encodeURIComponent(recipeId)}`, {
    ...options,
    auth: true,
    retry: options?.retry ?? true,
  });
}

function malformed() {
  return new ApiError('unknown_error', 'Malformed favorites response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The transport hands back null for an empty or non-JSON body and does not check the shape of
// a 2xx answer, so the shape is checked here before the store keeps anything.
function unwrapData(response: unknown): unknown {
  return isRecord(response) ? response.data : undefined;
}

function isFavoriteSummary(value: unknown): value is FavoriteSummary {
  return (
    isRecord(value) &&
    typeof value.recipeId === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.mainIngredients) &&
    value.mainIngredients.every((ingredient) => typeof ingredient === 'string') &&
    (value.durationMinutes === null || typeof value.durationMinutes === 'number')
  );
}
