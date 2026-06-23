import { apiClient } from '@/api/client';
import type {
  SlotCookingTimes,
  SlotCookingTimesPayload,
  UserPreferences,
  UserPreferencesPayload,
} from '@/features/auth/types/auth';
import type { RequestOptions } from '@/api/transport';

export function getUserPreferences(
  accessToken?: string | null,
  options?: RequestOptions
): Promise<UserPreferences> {
  return apiClient.get<UserPreferences>('/api/me/preferences', {
    ...options,
    auth: accessToken === undefined,
    accessToken,
    retry: options?.retry ?? true,
  });
}

export function updateUserPreferences(payload: UserPreferencesPayload): Promise<UserPreferences>;
export function updateUserPreferences(
  accessToken: string | null | undefined,
  payload: UserPreferencesPayload
): Promise<UserPreferences>;
export function updateUserPreferences(
  accessTokenOrPayload: string | null | undefined | UserPreferencesPayload,
  maybePayload?: UserPreferencesPayload
): Promise<UserPreferences> {
  const accessToken = maybePayload === undefined ? undefined : accessTokenOrPayload;
  const payload = maybePayload ?? (accessTokenOrPayload as UserPreferencesPayload);

  return apiClient.put<UserPreferences>('/api/me/preferences', payload, {
    auth: accessToken === undefined,
    accessToken: accessToken as string | null | undefined,
  });
}

export function getSlotCookingTimes(
  accessToken?: string | null,
  options?: RequestOptions
): Promise<SlotCookingTimes> {
  return apiClient.get<SlotCookingTimes>('/api/me/slot-cooking-times', {
    ...options,
    auth: accessToken === undefined,
    accessToken,
    retry: options?.retry ?? true,
  });
}

export function updateSlotCookingTimes(payload: SlotCookingTimesPayload): Promise<SlotCookingTimes>;
export function updateSlotCookingTimes(
  accessToken: string | null | undefined,
  payload: SlotCookingTimesPayload
): Promise<SlotCookingTimes>;
export function updateSlotCookingTimes(
  accessTokenOrPayload: string | null | undefined | SlotCookingTimesPayload,
  maybePayload?: SlotCookingTimesPayload
): Promise<SlotCookingTimes> {
  const accessToken = maybePayload === undefined ? undefined : accessTokenOrPayload;
  const payload = maybePayload ?? (accessTokenOrPayload as SlotCookingTimesPayload);

  return apiClient.put<SlotCookingTimes>('/api/me/slot-cooking-times', payload, {
    auth: accessToken === undefined,
    accessToken: accessToken as string | null | undefined,
  });
}
