// Pure mapping from the preferences form state to the typed payload that
// the backend's `MyFoodBack.Accounts.Catalog` module will accept.
//
// The form UI never sends a free-text value for `diet` or
// `hardRestrictions`; it only stores catalog codes and this helper validates
// them before the request. The profile screen uses it directly and the
// onboarding payload builder reuses the same validation.

import type { UserPreferences, UserPreferencesPayload } from '@/features/auth/types/auth';
import {
  isValidDietCode,
  isValidHardRestrictionCode,
  type DietCode,
  type HardRestrictionCode,
} from '@/features/preferences/constants/catalog';

export interface PreferencesFormState {
  /** Selected diet code from the catalog, or null when the user picked none. */
  diet: DietCode | null;
  /** Selected hard-restriction codes from the catalog. */
  hardRestrictions: HardRestrictionCode[];
  /** Free-form soft preferences (NOT catalog-restricted by spec). */
  softPreferences: string[];
}

export class PreferencesValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'PreferencesValidationError';
  }
}

function sanitizeSoftPreferences(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function validatePreferences(state: PreferencesFormState): UserPreferencesPayload {
  if (state.diet !== null && !isValidDietCode(state.diet)) {
    throw new PreferencesValidationError('preferences.diet', 'Unknown diet code.');
  }

  const seen = new Set<HardRestrictionCode>();
  const validated: HardRestrictionCode[] = [];
  for (const code of state.hardRestrictions) {
    if (!isValidHardRestrictionCode(code)) {
      throw new PreferencesValidationError(
        'preferences.hardRestrictions',
        `Unknown hard restriction code: ${String(code)}`
      );
    }
    if (seen.has(code)) continue;
    seen.add(code);
    validated.push(code);
  }

  return {
    diet: state.diet,
    hardRestrictions: validated,
    softPreferences: sanitizeSoftPreferences(state.softPreferences),
  };
}

// Profile (post-onboarding) preferences update. Same validation as
// onboarding but without the profile/slot fields.
export function buildPreferencesPayload(state: PreferencesFormState): UserPreferences {
  return validatePreferences(state);
}
