// Pure validation of the profile fields (name, household size, cooking
// skill). The settings screen uses it to update the profile and the
// onboarding payload builder reuses the same rules for its first step.

import type {
  CookingSkill,
  OnboardingProfile,
  ProfileUpdatePayload,
} from '@/features/auth/types/auth';
import { PreferencesValidationError } from '@/features/preferences/utils/preferencesPayload';

export interface ProfileFormState {
  displayName: string;
  /** Null while the stored profile has no household size yet. */
  householdSize: number | null;
  /** Null while the stored profile has no cooking skill yet. */
  cookingSkill: CookingSkill | null;
}

export function validateProfile(state: ProfileFormState): OnboardingProfile {
  const { householdSize, cookingSkill } = state;
  const displayName = state.displayName.trim();
  if (displayName.length < 1 || displayName.length > 60) {
    throw new PreferencesValidationError('displayName', 'Display name must be 1-60 characters.');
  }
  if (
    householdSize === null ||
    !Number.isInteger(householdSize) ||
    householdSize < 1 ||
    householdSize > 20
  ) {
    throw new PreferencesValidationError(
      'householdSize',
      'Household size must be an integer between 1 and 20.'
    );
  }
  const skills: readonly CookingSkill[] = ['beginner', 'intermediate', 'advanced'];
  if (cookingSkill === null || !skills.includes(cookingSkill)) {
    throw new PreferencesValidationError('cookingSkill', 'Unknown cooking skill.');
  }
  return { displayName, householdSize, cookingSkill };
}

// Profile (post-onboarding) name/household/skill update. Same rules as
// the onboarding profile step.
export function buildProfilePayload(state: ProfileFormState): ProfileUpdatePayload {
  return validateProfile(state);
}
