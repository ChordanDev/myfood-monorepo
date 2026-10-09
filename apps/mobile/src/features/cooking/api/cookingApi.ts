import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type { CookingFinish, CookingSessionStart } from '../types/cookingApi';

const COOKING_PATH = '/api/cooking';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Both calls change the server (a session opens, stock is consumed), so a repeat after a lost
// answer could not be told from a second cooking: neither is ever retried.
function postOptions(options?: RequestOptions) {
  return { ...options, auth: true, retry: false };
}

/** Opens a Cooking session for a Scheduled meal; the server refuses a meal not on its today. */
export async function startCookingSession(
  scheduledMealId: string,
  options?: RequestOptions
): Promise<CookingSessionStart> {
  const response = await apiClient.post<unknown>(
    `${COOKING_PATH}/start`,
    { scheduledMealId },
    postOptions(options)
  );

  return parseStartResponse(response);
}

/**
 * Finishes a Cooking session: the meal is cooked, its Ingredients leave the Inventory oldest
 * lot first and the answer says what was consumed and what the stock could not cover.
 */
export async function finishCookingSession(
  sessionId: string,
  options?: RequestOptions
): Promise<CookingFinish> {
  const response = await apiClient.post<unknown>(
    `${COOKING_PATH}/sessions/${encodeURIComponent(sessionId)}/finish`,
    undefined,
    postOptions(options)
  );

  return parseFinishResponse(response);
}

// The transport does not check the shape of a 2xx answer, so one without the members the app
// reads is treated like any other unintelligible server answer.
function parseStartResponse(response: unknown): CookingSessionStart {
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data) || typeof data.sessionId !== 'string' || data.sessionId === '') {
    throw new ApiError('unknown_error', 'Malformed cooking start response');
  }

  return data as unknown as CookingSessionStart;
}

function parseFinishResponse(response: unknown): CookingFinish {
  const data = isRecord(response) ? response.data : undefined;

  if (
    !isRecord(data) ||
    !isRecord(data.scheduledMeal) ||
    !Array.isArray(data.inventoryMutations) ||
    !Array.isArray(data.shortages)
  ) {
    throw new ApiError('unknown_error', 'Malformed cooking finish response');
  }

  return data as unknown as CookingFinish;
}
