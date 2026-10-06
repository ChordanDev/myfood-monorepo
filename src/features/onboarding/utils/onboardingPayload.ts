// Pure mapping from onboarding form state to the typed payload that
// the backend's `MyFoodBack.Accounts.Catalog` module will accept.
//
// Extracted from `app/onboarding.tsx` so the serialization rules can be
// unit-tested without rendering React or making network calls. The form
// UI never sends a free-text value for `diet` or `hardRestrictions`;
// instead it only stores catalog codes and the helper validates them
// before the POST. The preference half of that validation is owned by
// `preferencesPayload.ts`, which the profile screen uses on its own.

import type {
  CookingSkill,
  HungerLevel,
  MealSlot,
  OnboardingCompletionRequest,
  SlotCookingTime,
  SlotCookingTimesPayload,
  UserPreferencesPayload,
} from '@/features/auth/types/auth';
import {
  PreferencesValidationError,
  validatePreferences,
  type PreferencesFormState,
} from '@/features/preferences/utils/preferencesPayload';

export interface OnboardingFormState {
  displayName: string;
  householdSize: number;
  cookingSkill: CookingSkill;
  preferences: PreferencesFormState;
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

// Callers of the onboarding builder only know `OnboardingValidationError`, so
// a preferences failure is rethrown as one, with the same field and message.
function validateOnboardingPreferences(state: PreferencesFormState): UserPreferencesPayload {
  try {
    return validatePreferences(state);
  } catch (error) {
    if (error instanceof PreferencesValidationError) {
      throw new OnboardingValidationError(error.field, error.message);
    }
    throw error;
  }
}

export function buildOnboardingPayload(state: OnboardingFormState): OnboardingCompletionRequest {
  validateProfile(state);

  const preferences = validateOnboardingPreferences(state.preferences);

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
