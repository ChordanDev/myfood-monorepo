import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type { CreatePreparedLeftoverInput, PreparedLeftover } from '../types';

const LEFTOVERS_PATH = '/api/leftovers/prepared';

/** Open leftovers of the Account, soonest consume-by date first (the server's order). */
export async function listPreparedLeftovers(options?: RequestOptions): Promise<PreparedLeftover[]> {
  const response = await apiClient.get<unknown>(LEFTOVERS_PATH, {
    ...options,
    auth: true,
    retry: options?.retry ?? true,
  });
  const data = isRecord(response) ? response.data : undefined;

  if (!Array.isArray(data) || !data.every(isPreparedLeftover)) {
    throw malformed();
  }

  return data;
}

export async function createPreparedLeftover(
  input: CreatePreparedLeftoverInput,
  options?: RequestOptions
): Promise<PreparedLeftover> {
  return parseItem(
    await apiClient.post<unknown>(LEFTOVERS_PATH, input, { ...options, auth: true })
  );
}

/**
 * Eats one portion; the leftover closes when none are left. The server eats once per
 * `actionId` within 24 hours, so a retry after a timeout sends the same one and eats nothing
 * more.
 */
export async function consumePreparedLeftover(
  id: string,
  actionId: string,
  options?: RequestOptions
): Promise<PreparedLeftover> {
  return parseItem(
    await apiClient.post<unknown>(
      `${LEFTOVERS_PATH}/${encodeURIComponent(id)}/consume`,
      { actionId },
      {
        ...options,
        auth: true,
      }
    )
  );
}

export async function discardPreparedLeftover(
  id: string,
  options?: RequestOptions
): Promise<PreparedLeftover> {
  return parseItem(
    await apiClient.post<unknown>(
      `${LEFTOVERS_PATH}/${encodeURIComponent(id)}/discard`,
      undefined,
      {
        ...options,
        auth: true,
      }
    )
  );
}

function malformed() {
  return new ApiError('unknown_error', 'Malformed prepared leftover response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

// The transport does not check the shape of a 2xx answer, so a guard stands between it and
// the screen.
function isPreparedLeftover(value: unknown): value is PreparedLeftover {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.portions === 'number' &&
    typeof value.storedAt === 'string' &&
    typeof value.consumeByDate === 'string' &&
    isStringOrNull(value.sourceMealId) &&
    isStringOrNull(value.notes) &&
    isStringOrNull(value.consumedAt) &&
    isStringOrNull(value.discardedAt)
  );
}

function parseItem(response: unknown): PreparedLeftover {
  const data = isRecord(response) ? response.data : undefined;

  if (!isPreparedLeftover(data)) {
    throw malformed();
  }

  return data;
}
