import { canSubmitOnboarding } from '../utils/onboardingSubmitGate';

describe('canSubmitOnboarding (Judgment Day S4)', () => {
  const base = {
    isLoading: false,
    isSubmitting: false,
    hasAccessToken: true,
    isValid: true,
  } as const;

  it('allows submit when the form is valid, hydrated, and the user has a token', () => {
    expect(canSubmitOnboarding({ ...base })).toBe(true);
  });

  it('blocks submit while AuthContext is hydrating', () => {
    expect(canSubmitOnboarding({ ...base, isLoading: true })).toBe(false);
  });

  it('blocks submit while a previous submission is in flight', () => {
    expect(canSubmitOnboarding({ ...base, isSubmitting: true })).toBe(false);
  });

  it('blocks submit when the bearer token is missing', () => {
    expect(canSubmitOnboarding({ ...base, hasAccessToken: false })).toBe(false);
  });

  it('blocks submit when the form is invalid', () => {
    expect(canSubmitOnboarding({ ...base, isValid: false })).toBe(false);
  });

  it('blocks submit when hydration is in flight even if the form looks valid', () => {
    expect(
      canSubmitOnboarding({ ...base, isLoading: true, isSubmitting: false, hasAccessToken: true })
    ).toBe(false);
  });
});
