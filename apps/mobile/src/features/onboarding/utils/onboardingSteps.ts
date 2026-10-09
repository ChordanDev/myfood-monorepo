// Pure rules of the onboarding wizard: which steps exist, how to move between
// them and whether the data of one step is good enough to leave it.
//
// Kept out of `OnboardingScreen` so the rules can be unit-tested without
// rendering React. `buildOnboardingPayload` still validates the final payload;
// these checks run earlier, one step at a time, and return the message the
// screen shows above its primary button.

import { MEAL_SLOT_LABEL } from '@/constants/mealSlots';
import type { CookingSkill, CookingTimeSlot } from '@/features/auth/types/auth';
import {
  isValidDietCode,
  isValidHardRestrictionCode,
  type DietCode,
  type HardRestrictionCode,
} from '@/features/preferences/constants/catalog';
import {
  COOKING_SKILLS,
  HUNGER_LEVELS,
  COOKING_TIME_SLOTS,
  SLOT_PRESET_BUCKETS,
} from '@/features/preferences/constants/preferenceOptions';
import type { SlotFormState } from '@/features/onboarding/utils/onboardingSlot';

export const ONBOARDING_STEPS = ['household', 'preferences', 'mealTimes'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const MIN_HOUSEHOLD_SIZE = 1;
export const MAX_HOUSEHOLD_SIZE = 20;
export const MAX_DISPLAY_NAME_LENGTH = 60;

/** Everything the user has entered so far, as the screen holds it. */
export interface OnboardingDraft {
  displayName: string;
  householdSize: number;
  cookingSkill: CookingSkill;
  diet: DietCode | null;
  hardRestrictions: readonly HardRestrictionCode[];
  /** Raw comma-separated text; it is parsed only when the payload is built. */
  softPreferences: string;
  slots: Record<CookingTimeSlot, SlotFormState>;
}

/** 1-based position of the step, as shown in "Paso N de 3". */
export function getStepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

export function getNextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null;
}

export function getPreviousStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1] ?? null;
}

export function clampHouseholdSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_HOUSEHOLD_SIZE;
  return Math.min(MAX_HOUSEHOLD_SIZE, Math.max(MIN_HOUSEHOLD_SIZE, Math.floor(value)));
}

function validateHousehold(draft: OnboardingDraft): string | null {
  const name = draft.displayName.trim();
  if (name.length < 1) return 'Escribí un nombre para mostrar.';
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return `El nombre puede tener hasta ${MAX_DISPLAY_NAME_LENGTH} caracteres.`;
  }
  if (
    !Number.isInteger(draft.householdSize) ||
    draft.householdSize < MIN_HOUSEHOLD_SIZE ||
    draft.householdSize > MAX_HOUSEHOLD_SIZE
  ) {
    return `Indicá entre ${MIN_HOUSEHOLD_SIZE} y ${MAX_HOUSEHOLD_SIZE} personas en casa.`;
  }
  if (!COOKING_SKILLS.includes(draft.cookingSkill)) return 'Elegí tu experiencia cocinando.';
  return null;
}

function validatePreferences(draft: OnboardingDraft): string | null {
  if (draft.diet !== null && !isValidDietCode(draft.diet)) return 'Elegí una dieta de la lista.';
  if (!draft.hardRestrictions.every(isValidHardRestrictionCode)) {
    return 'Revisá las restricciones seleccionadas.';
  }
  // Soft preferences are free text and optional: nothing to check.
  return null;
}

function validateSlot(form: SlotFormState): string | null {
  if (form.mode === 'preset') {
    // The bucket list includes 0, which means "no cook" and has its own mode.
    if (form.preset <= 0 || !SLOT_PRESET_BUCKETS.includes(form.preset)) {
      return 'elegí un tiempo rápido de la lista.';
    }
  }
  if (form.mode === 'custom') {
    // Digits only: an empty field used to be sent as 0 minutes.
    if (!/^\d+$/.test(form.customText) || Number.parseInt(form.customText, 10) < 1) {
      return 'ingresá los minutos, con un mínimo de 1.';
    }
  }
  if (!HUNGER_LEVELS.includes(form.hunger)) return 'elegí el nivel de hambre.';
  return null;
}

function validateMealTimes(draft: OnboardingDraft): string | null {
  for (const slot of COOKING_TIME_SLOTS) {
    const problem = validateSlot(draft.slots[slot]);
    if (problem !== null) return `${MEAL_SLOT_LABEL[slot]}: ${problem}`;
  }
  return null;
}

/**
 * Checks the data of a single step. Returns the user-facing message for the
 * first problem found, or `null` when the step can be left.
 */
export function validateOnboardingStep(
  step: OnboardingStep,
  draft: OnboardingDraft
): string | null {
  if (step === 'household') return validateHousehold(draft);
  if (step === 'preferences') return validatePreferences(draft);
  return validateMealTimes(draft);
}
