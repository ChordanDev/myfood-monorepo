import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type {
  ProfileUpdatePayload,
  ProfileUpdateResponse,
  ProfileUpdateUser,
  SlotCookingTimes,
  SlotCookingTimesPayload,
  UserPreferences,
  UserPreferencesPayload,
} from '@/features/auth/types/auth';
import { normalizeProfileFields } from '@/features/auth/utils/currentMe';
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

export function updateProfile(payload: ProfileUpdatePayload): Promise<ProfileUpdateResponse>;
export function updateProfile(
  accessToken: string | null | undefined,
  payload: ProfileUpdatePayload
): Promise<ProfileUpdateResponse>;
export async function updateProfile(
  accessTokenOrPayload: string | null | undefined | ProfileUpdatePayload,
  maybePayload?: ProfileUpdatePayload
): Promise<ProfileUpdateResponse> {
  const accessToken = maybePayload === undefined ? undefined : accessTokenOrPayload;
  const payload = maybePayload ?? (accessTokenOrPayload as ProfileUpdatePayload);

  const response = await apiClient.put<unknown>('/api/me/profile', payload, {
    auth: accessToken === undefined,
    accessToken: accessToken as string | null | undefined,
  });
  return parseProfileUpdateResponse(response);
}

// The transport hands back null for an empty or non-JSON body and does
// not check the shape of a 2xx answer, so the caller would otherwise
// patch `me` from whatever arrived. A response without a usable user id
// is treated like any other unintelligible server answer.
function parseProfileUpdateResponse(response: unknown): ProfileUpdateResponse {
  const user = (response as { user?: Partial<ProfileUpdateUser> | null } | null)?.user;
  if (typeof user?.id !== 'string' || user.id.length === 0) {
    throw new ApiError('unknown_error', 'Malformed profile update response');
  }
  return { user: normalizeProfileFields(user as ProfileUpdateUser) };
}
