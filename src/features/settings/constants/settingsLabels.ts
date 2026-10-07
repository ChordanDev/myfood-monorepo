import type { AuthAccountType } from '@/features/auth/types/auth';
import type { ProfileFormState } from '@/features/preferences/utils/profilePayload';

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

export const ACCOUNT_TYPE_LABELS: Record<AuthAccountType, string> = {
  individual: 'Individual',
  family: 'Familiar',
  family_plus: 'Familiar Plus',
};

// Inline messages for a profile field that fails the onboarding rules.
export const PROFILE_FIELD_ERRORS: Record<ProfileField, string> = {
  displayName: 'Ingresá un nombre de 1 a 60 caracteres.',
  householdSize: 'Indicá cuántas personas son en casa, de 1 a 20.',
  cookingSkill: 'Elegí tu experiencia cocinando.',
};

// Shown in place of a value that depends on data still loading or not loaded.
export const LOADING_VALUE_LABEL = 'Cargando…';
export const UNAVAILABLE_VALUE_LABEL = 'No disponible';
