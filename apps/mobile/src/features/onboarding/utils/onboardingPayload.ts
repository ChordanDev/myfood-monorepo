// Pure mapping from onboarding form state to the typed payload that
// the backend's `MyFoodBack.Accounts.Catalog` module will accept.
//
// Extracted from `app/onboarding.tsx` so the serialization rules can be
// unit-tested without rendering React or making network calls. The form
// UI never sends a free-text value for `diet` or `hardRestrictions`;
// instead it only stores catalog codes and the helper validates them
// before the POST. The profile and preference halves of that validation
// are owned by `profilePayload.ts` and `preferencesPayload.ts` in the
// preferences feature, which the settings screen uses on its own.

import type {
  CookingSkill,
  CookingTimeSlot,
  HungerLevel,
  OnboardingCompletionRequest,
  SlotCookingTime,
  SlotCookingTimesPayload,
} from '@/features/auth/types/auth';
import {
  PreferencesValidationError,
  validatePreferences,
  type PreferencesFormState,
} from '@/features/preferences/utils/preferencesPayload';
import { validateProfile } from '@/features/preferences/utils/profilePayload';

export interface OnboardingFormState {
  displayName: string;
  householdSize: number;
  cookingSkill: CookingSkill;
  preferences: PreferencesFormState;
  slotCookingTimes: Record<CookingTimeSlot, SlotCookingTime>;
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

function validateSlot(slot: CookingTimeSlot, value: SlotCookingTime): void {
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
// a failure of the shared profile or preferences validation is rethrown as
// one, with the same field and message.
function asOnboardingError<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof PreferencesValidationError) {
      throw new OnboardingValidationError(error.field, error.message);
    }
    throw error;
  }
}

export function buildOnboardingPayload(state: OnboardingFormState): OnboardingCompletionRequest {
  const profile = asOnboardingError(() => validateProfile(state));

  const preferences = asOnboardingError(() => validatePreferences(state.preferences));

  const slots: SlotCookingTimesPayload = {
    breakfast: state.slotCookingTimes.breakfast,
    lunch: state.slotCookingTimes.lunch,
    dinner: state.slotCookingTimes.dinner,
  };
  (Object.keys(slots) as CookingTimeSlot[]).forEach((slot) => validateSlot(slot, slots[slot]));

  return {
    profile,
    preferences,
    slotCookingTimes: slots,
  };
}
