import { buildApiUrl } from './config';
import { ApiError, errorFromEnvelope, isApiError, isTransientAuthError } from './errors';
import { newRequestId } from './requestId';

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const REFRESH_REQUEST_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  timeoutMs?: number;
  retry?: boolean;
  headers?: HeadersInit;
}

export interface RawApiRequestOptions extends RequestOptions {
  accessToken?: string | null;
  init?: RequestInit;
}

export async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function rawApiRequest<T>(
  path: string,
  {
    accessToken,
    init = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    retry = false,
    headers,
  }: RawApiRequestOptions = {}
): Promise<T> {
  const execute = async (): Promise<T> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;

    try {
      response = await fetch(buildApiUrl(path), {
        ...init,
        headers: {
          Accept: 'application/json',
          'X-Request-Id': newRequestId(),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...stripAuthorizationHeader(headers ?? init.headers),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (isApiError(error)) throw error;
      if (isAbortError(error)) {
        throw new ApiError('timeout', 'Request timeout', 0);
      }
      throw new ApiError('network_error', 'Network request failed');
    } finally {
      clearTimeout(timeoutHandle);
    }

    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw errorFromEnvelope(payload, response.status);
    }

    return payload as T;
  };

  try {
    return await execute();
  } catch (error) {
    if (retry && isTransientAuthError(error)) {
      return execute();
    }
    throw error;
  }
}

function stripAuthorizationHeader(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() !== 'authorization') {
        result[key] = value;
      }
    }
    return result;
  }

  if (typeof (headers as Headers).forEach === 'function') {
    (headers as Headers).forEach((value, key) => {
      if (key.toLowerCase() !== 'authorization') {
        result[key] = value;
      }
    });
    return result;
  }

  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() !== 'authorization') {
      result[key] = value;
    }
  }
  return result;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
