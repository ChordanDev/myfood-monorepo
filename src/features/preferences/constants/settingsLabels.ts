import type { ProfileFormState } from '@/features/preferences/utils/onboardingPayload';

export type ProfileField = keyof ProfileFormState;
export type PreferenceField = 'diet' | 'hardRestrictions' | 'softPreferences';

// Row labels of the settings screen. The editor sheets reuse them as titles.
export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  displayName: 'Nombre para mostrar',
  householdSize: 'Personas en casa',
  cookingSkill: 'Experiencia cocinando',
};

export const PREFERENCE_FIELD_LABELS: Record<PreferenceField, string> = {
  diet: 'Dieta',
  hardRestrictions: 'Restricciones duras',
  softPreferences: 'Preferencias suaves',
};

// Shown in place of a value that depends on data still loading or not loaded.
export const LOADING_VALUE_LABEL = 'Cargando…';
export const UNAVAILABLE_VALUE_LABEL = 'No disponible';
