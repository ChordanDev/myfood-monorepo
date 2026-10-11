import { errorFromEnvelope, type ApiError } from '@/api/errors';
import type { UserPreferences } from '@/features/auth/types/auth';
import invalidDiet from './invalidDiet.json';
import invalidHardRestriction from './invalidHardRestriction.json';
import preferences from './preferences.json';

// The frozen body of `GET` and `PUT /api/me/preferences`. Every field is checked against
// `UserPreferences` by the compiler.
export function fixturePreferences(): UserPreferences {
  return {
    ...preferences,
    hardRestrictions: [...preferences.hardRestrictions],
    softPreferences: [...preferences.softPreferences],
  };
}

// The frozen 422 body `PUT /api/me/preferences` and `POST /api/onboarding/complete` answer
// to a Diet outside the catalog.
export function fixtureInvalidDiet(): typeof invalidDiet {
  return { error: { ...invalidDiet.error } };
}

// That 422 as the api client throws it.
export function fixtureInvalidDietError(): ApiError {
  return errorFromEnvelope(fixtureInvalidDiet(), 422);
}

// The frozen 422 body the same two routes answer to a Hard restriction outside the catalog.
export function fixtureInvalidHardRestriction(): typeof invalidHardRestriction {
  return { error: { ...invalidHardRestriction.error } };
}

// That 422 as the api client throws it.
export function fixtureInvalidHardRestrictionError(): ApiError {
  return errorFromEnvelope(fixtureInvalidHardRestriction(), 422);
}
