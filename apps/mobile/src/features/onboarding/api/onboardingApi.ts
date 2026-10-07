import { apiClient } from '@/api/client';
import type {
  OnboardingCompletionRequest,
  OnboardingCompletionResponse,
} from '@/features/auth/types/auth';

export function completeOnboarding(
  payload: OnboardingCompletionRequest
): Promise<OnboardingCompletionResponse>;
export function completeOnboarding(
  accessToken: string | null | undefined,
  payload: OnboardingCompletionRequest
): Promise<OnboardingCompletionResponse>;
export function completeOnboarding(
  accessTokenOrPayload: string | null | undefined | OnboardingCompletionRequest,
  maybePayload?: OnboardingCompletionRequest
): Promise<OnboardingCompletionResponse> {
  const accessToken = maybePayload === undefined ? undefined : accessTokenOrPayload;
  const payload = maybePayload ?? (accessTokenOrPayload as OnboardingCompletionRequest);

  return apiClient.post<OnboardingCompletionResponse>('/api/onboarding/complete', payload, {
    auth: accessToken === undefined,
    accessToken: accessToken as string | null | undefined,
  });
}
