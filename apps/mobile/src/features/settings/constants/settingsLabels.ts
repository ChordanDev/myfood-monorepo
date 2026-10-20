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

// Why a retry is offered, for each part of the screen that loads on its own.
export const PREFERENCES_LOAD_ERROR_MESSAGE =
  'No pudimos cargar tus preferencias ni tus tiempos por comida. Reintentá para verlos y editarlos.';
export const BUDGET_LOAD_ERROR_MESSAGE =
  'No pudimos cargar tu presupuesto semanal. Reintentá para verlo.';

// The Account's weekly Budget row (issue #271). Its sheet reuses the label as its title.
export const BUDGET_LABEL = 'Presupuesto semanal';
export const BUDGET_INPUT_PLACEHOLDER = 'Monto en pesos';
export const BUDGET_DEFAULT_SUFFIX = '(por defecto)';
export const BUDGET_NO_MINIMUM_LABEL = 'Sin mínimo por ahora';
export const BUDGET_INVALID_AMOUNT_MESSAGE = 'Ingresá un monto en pesos, sin centavos.';
export const BUDGET_TOO_LARGE_MESSAGE = 'Ingresá un monto menor.';
