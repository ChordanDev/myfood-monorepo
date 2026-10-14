import { errorFromEnvelope, type ApiError } from '@/api/errors';
import { oneOf } from '@/features/auth/fixtures/oneOf';
import type { OnboardingCompletionResponse } from '@/features/auth/types/auth';
import { COOKING_SKILLS } from '@/features/preferences/constants/preferenceOptions';
import { narrowSlotCookingTimes } from '@/features/preferences/fixtures/slotCookingTimes';
import invalidCookingSkill from './invalidCookingSkill.json';
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

// The frozen 422 body `POST /api/onboarding/complete` and `PUT /api/me/profile` answer to a
// Cooking skill outside the catalog.
export function fixtureInvalidCookingSkill(): typeof invalidCookingSkill {
  return { error: { ...invalidCookingSkill.error } };
}

// That 422 as the api client throws it.
export function fixtureInvalidCookingSkillError(): ApiError {
  return errorFromEnvelope(fixtureInvalidCookingSkill(), 422);
}
