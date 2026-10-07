// Pure draft model for the settings editor sheets.
//
// Opening a row creates a draft from the saved value, the editor mutates
// only the draft, and saving turns it into the full payload the endpoint
// expects with every untouched field copied from the saved state. No
// React here, so each rule is unit-tested without rendering.

import type {
  AuthUser,
  MealSlot,
  SlotCookingTime,
  SlotCookingTimes,
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
import {
  SLOT_LABELS,
  SLOT_PRESET_BUCKETS,
} from '@/features/preferences/constants/onboardingOptions';
import {
  buildPreferencesPayload,
  type ProfileFormState,
} from '@/features/preferences/utils/onboardingPayload';
import { parseListInput } from '@/features/preferences/utils/parseListInput';
import {
  PREFERENCE_FIELD_LABELS,
  PROFILE_FIELD_LABELS,
  type PreferenceField,
  type ProfileField,
} from '../constants/settingsLabels';

const PROFILE_FIELDS: readonly ProfileField[] = ['displayName', 'householdSize', 'cookingSkill'];
const HOUSEHOLD_SIZE_MIN = 1;
const HOUSEHOLD_SIZE_MAX = 20;

export type SettingsEditorTarget =
  | { kind: 'profile'; field: ProfileField }
  | { kind: PreferenceField }
  | { kind: 'slot'; slot: MealSlot };

export interface ProfileDraft {
  kind: 'profile';
  /** The row that opened the editor. */
  field: ProfileField;
  /** Other fields with no stored value: the full payload needs them too. */
  missingFields: ProfileField[];
  values: ProfileFormState;
}

/** A profile value that failed validation, shown next to its control. */
export interface ProfileFieldError {
  field: ProfileField;
  message: string;
}

export interface DietDraft {
  kind: 'diet';
  diet: DietCode | null;
}

export interface HardRestrictionsDraft {
  kind: 'hardRestrictions';
  selected: HardRestrictionCode[];
  /** Saved codes the catalog cannot show. They are kept on save. */
  unknownCodes: string[];
}

export interface SoftPreferencesDraft {
  kind: 'softPreferences';
  /** Comma-separated list, as typed. */
  text: string;
}

export interface SlotDraft {
  kind: 'slot';
  slot: MealSlot;
  value: SlotCookingTime;
  /** The presets, plus the saved time when it is not one of them. */
  minuteOptions: number[];
}

export type PreferenceDraft = DietDraft | HardRestrictionsDraft | SoftPreferencesDraft;
export type SettingsDraft = ProfileDraft | PreferenceDraft | SlotDraft;

function isMissing(user: Pick<AuthUser, ProfileField>, field: ProfileField): boolean {
  if (field === 'displayName') return !user.displayName?.trim();
  return user[field] === null;
}

export function createProfileDraft(
  user: Pick<AuthUser, ProfileField>,
  field: ProfileField
): ProfileDraft {
  return {
    kind: 'profile',
    field,
    missingFields: PROFILE_FIELDS.filter((other) => other !== field && isMissing(user, other)),
    values: {
      displayName: user.displayName ?? '',
      householdSize: user.householdSize,
      cookingSkill: user.cookingSkill,
    },
  };
}

export function isProfileField(value: string): value is ProfileField {
  return (PROFILE_FIELDS as readonly string[]).includes(value);
}

export function stepHouseholdSize(current: number | null, delta: 1 | -1): number {
  if (current === null) return HOUSEHOLD_SIZE_MIN;
  return Math.min(HOUSEHOLD_SIZE_MAX, Math.max(HOUSEHOLD_SIZE_MIN, current + delta));
}

export function createPreferenceDraft(
  field: PreferenceField,
  saved: UserPreferences
): PreferenceDraft {
  if (field === 'diet') {
    return { kind: 'diet', diet: isValidDietCode(saved.diet) ? saved.diet : null };
  }
  if (field === 'hardRestrictions') {
    return {
      kind: 'hardRestrictions',
      selected: saved.hardRestrictions.filter(isValidHardRestrictionCode),
      unknownCodes: saved.hardRestrictions.filter((code) => !isValidHardRestrictionCode(code)),
    };
  }
  return { kind: 'softPreferences', text: saved.softPreferences.join(', ') };
}

export function toggleHardRestriction(
  selected: readonly HardRestrictionCode[],
  code: HardRestrictionCode
): HardRestrictionCode[] {
  return selected.includes(code) ? selected.filter((entry) => entry !== code) : [...selected, code];
}

// The untouched fields are copied as saved, even when the catalog does not
// know their codes: this edit must not change what it did not show.
export function buildPreferencesEdit(
  draft: PreferenceDraft,
  saved: UserPreferences
): UserPreferencesPayload {
  if (draft.kind === 'diet') {
    return { ...saved, diet: draft.diet };
  }
  if (draft.kind === 'hardRestrictions') {
    return { ...saved, hardRestrictions: [...draft.selected, ...draft.unknownCodes] };
  }
  // Same trimming and de-duplication as the onboarding form.
  const { softPreferences } = buildPreferencesPayload({
    diet: null,
    hardRestrictions: [],
    softPreferences: parseListInput(draft.text),
  });
  return { ...saved, softPreferences };
}

export function createSlotDraft(slot: MealSlot, saved: SlotCookingTimes): SlotDraft {
  const value = saved[slot];
  const minuteOptions = SLOT_PRESET_BUCKETS.includes(value.cookingTimeMinutes)
    ? [...SLOT_PRESET_BUCKETS]
    : [...SLOT_PRESET_BUCKETS, value.cookingTimeMinutes].sort((a, b) => a - b);
  return { kind: 'slot', slot, value, minuteOptions };
}

export function buildSlotTimesEdit(
  draft: SlotDraft,
  saved: SlotCookingTimes
): SlotCookingTimesPayload {
  return { ...saved, [draft.slot]: draft.value };
}

export function getSettingsDraftTitle(draft: SettingsDraft): string {
  if (draft.kind === 'profile') return PROFILE_FIELD_LABELS[draft.field];
  if (draft.kind === 'slot') return SLOT_LABELS[draft.slot];
  return PREFERENCE_FIELD_LABELS[draft.kind];
}
