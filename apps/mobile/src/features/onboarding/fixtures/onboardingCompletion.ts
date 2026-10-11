import { oneOf } from '@/features/auth/fixtures/oneOf';
import type { OnboardingCompletionResponse } from '@/features/auth/types/auth';
import { COOKING_SKILLS } from '@/features/preferences/constants/preferenceOptions';
import { narrowSlotCookingTimes } from '@/features/preferences/fixtures/slotCookingTimes';
import onboardingCompletion from './onboardingCompletion.json';

// The frozen `POST /api/onboarding/complete` body. The Cooking skill and the Hunger levels
// are narrowed here; every other field is checked against `OnboardingCompletionResponse` by
// the compiler.
export function fixtureOnboardingCompletion(): OnboardingCompletionResponse {
  const { user, preferences, slotCookingTimes } = onboardingCompletion;

  return {
    user: { ...user, cookingSkill: oneOf(COOKING_SKILLS, user.cookingSkill) },
    preferences: {
      ...preferences,
      hardRestrictions: [...preferences.hardRestrictions],
      softPreferences: [...preferences.softPreferences],
    },
    slotCookingTimes: narrowSlotCookingTimes(slotCookingTimes),
  };
}
