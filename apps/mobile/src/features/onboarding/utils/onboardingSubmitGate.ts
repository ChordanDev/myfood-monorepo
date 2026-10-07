// Pure helper that decides whether the Onboarding form is allowed to
// submit. Extracted from `app/onboarding.tsx` so the rule can be
// unit-tested without rendering React. The same rule applies in the
// profile edit screen (loadStatus + saving) but with different inputs.
//
// Judgment Day S4: the screen MUST block submit while the AuthContext
// has not finished hydrating (isLoading=true) or while the bearer
// token is missing. Otherwise a deep-link to `/onboarding` would
// either POST without auth (401) or race the hydration and leave the
// user wedged.

export interface OnboardingSubmitGateInput {
  isLoading: boolean;
  isSubmitting: boolean;
  hasAccessToken: boolean;
  isValid: boolean;
}

export function canSubmitOnboarding(input: OnboardingSubmitGateInput): boolean {
  if (input.isLoading) return false;
  if (input.isSubmitting) return false;
  if (!input.hasAccessToken) return false;
  return input.isValid;
}
