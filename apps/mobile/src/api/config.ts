import { ApiError } from './errors';

export function getApiBaseUrl(): string {
  const rawUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (!rawUrl) {
    throw new ApiError(
      'configuration_error',
      'EXPO_PUBLIC_API_URL is required to connect to the backend API.'
    );
  }

  return rawUrl.replace(/\/+$/, '');
}

export function buildApiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}
