import type { UserPreferences } from '@/features/auth/types/auth';
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
