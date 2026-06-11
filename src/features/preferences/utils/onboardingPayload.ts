// Pure mapping from onboarding form state to the typed payload that
// the backend's `MyFoodBack.Accounts.Catalog` module will accept.
//
// Extracted from `app/onboarding.tsx` so the serialization rules can be
// unit-tested without rendering React or making network calls. The form
// UI never sends a free-text value for `diet` or `hardRestrictions`;
// instead it only stores catalog codes and the helper validates them
// before the POST.

import type {
  CookingSkill,
  HungerLevel,
  MealSlot,
  OnboardingCompletionRequest,
  SlotCookingTime,
  SlotCookingTimesPayload,
  UserPreferences,
  UserPreferencesPayload,
} from '@/features/auth/types/auth';
import {
  isValidDietCode,
  isValidHardRestrictionCode,
  type DietCode,
  type HardRestrictionCode,
} from '@/features/preferences/constants/catalog';

export interface OnboardingFormDietState {
  /** Selected diet code from the catalog, or null when the user picked none. */
  diet: DietCode | null;
  /** Selected hard-restriction codes from the catalog. */
  hardRestrictions: HardRestrictionCode[];
  /** Free-form soft preferences (NOT catalog-restricted by spec). */
  softPreferences: string[];
}

export interface OnboardingFormState {
  displayName: string;
  householdSize: number;
  cookingSkill: CookingSkill;
  preferences: OnboardingFormDietState;
  slotCookingTimes: Record<MealSlot, SlotCookingTime>;
}

export class OnboardingValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'OnboardingValidationError';
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

function validateProfile(state: OnboardingFormState): void {
  const name = state.displayName.trim();
  if (name.length < 1 || name.length > 60) {
    throw new OnboardingValidationError('displayName', 'Display name must be 1-60 characters.');
  }
  if (
    !Number.isInteger(state.householdSize) ||
    state.householdSize < 1 ||
    state.householdSize > 20
  ) {
    throw new OnboardingValidationError(
      'householdSize',
      'Household size must be an integer between 1 and 20.'
    );
  }
  const skills: readonly CookingSkill[] = ['beginner', 'intermediate', 'advanced'];
  if (!skills.includes(state.cookingSkill)) {
    throw new OnboardingValidationError('cookingSkill', 'Unknown cooking skill.');
  }
}

function validateSlot(slot: MealSlot, value: SlotCookingTime): void {
  if (!Number.isInteger(value.cookingTimeMinutes) || value.cookingTimeMinutes < 0) {
    throw new OnboardingValidationError(
      `slotCookingTimes.${slot}.cookingTimeMinutes`,
      'Cooking time must be a non-negative integer.'
    );
  }
  const hungers: readonly HungerLevel[] = ['light', 'normal', 'strong'];
  if (!hungers.includes(value.hungerLevel)) {
    throw new OnboardingValidationError(
      `slotCookingTimes.${slot}.hungerLevel`,
      'Unknown hunger level.'
    );
  }
}

function validatePreferences(state: OnboardingFormDietState): UserPreferencesPayload {
  if (state.diet !== null && !isValidDietCode(state.diet)) {
    throw new OnboardingValidationError('preferences.diet', 'Unknown diet code.');
  }

  const seen = new Set<HardRestrictionCode>();
  const validated: HardRestrictionCode[] = [];
  for (const code of state.hardRestrictions) {
    if (!isValidHardRestrictionCode(code)) {
      throw new OnboardingValidationError(
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

export function buildOnboardingPayload(state: OnboardingFormState): OnboardingCompletionRequest {
  validateProfile(state);

  const preferences = validatePreferences(state.preferences);

  const slots: SlotCookingTimesPayload = {
    breakfast: state.slotCookingTimes.breakfast,
    lunch: state.slotCookingTimes.lunch,
    dinner: state.slotCookingTimes.dinner,
  };
  (Object.keys(slots) as MealSlot[]).forEach((slot) => validateSlot(slot, slots[slot]));

  return {
    profile: {
      displayName: state.displayName.trim(),
      householdSize: state.householdSize,
      cookingSkill: state.cookingSkill,
    },
    preferences,
    slotCookingTimes: slots,
  };
}

// Profile (post-onboarding) preferences update. Same validation as
// onboarding but without the profile/slot fields.
export function buildPreferencesPayload(state: OnboardingFormDietState): UserPreferences {
  return validatePreferences(state);
}
