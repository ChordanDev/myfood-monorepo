// Catalog codes for diet and hard_restrictions.
//
// Source of truth is the backend: the Diet codes are `@diet_codes` in
// `MealPlannerApi.Services.UserPreferencesService`
// (`apps/api/lib/meal_planner_api/services/user_preferences_service.ex`)
// and the Hard restriction codes are
// `MealPlannerApi.Persistence.Accounts.UserHardRestriction.codes/0`
// (`apps/api/lib/meal_planner_api/persistence/accounts/user_hard_restriction.ex`).
// If either backend list ever changes, update this file in the same commit
// and add a regression test that fails when the UI allows an unknown code.
//
// soft_preferences is intentionally NOT catalog-restricted; the spec keeps
// it as a free-form string list.
//
// `null` for diet means "user did not pick a diet" and is a valid state.

import type { HungerLevel } from '@/features/auth/types/auth';

export const DIET_CODES = ['omnivore', 'vegetarian', 'vegan', 'pescatarian'] as const;

export type DietCode = (typeof DIET_CODES)[number];

export const HARD_RESTRICTION_CODES = [
  'peanut',
  'tree_nut',
  'shellfish',
  'gluten',
  'dairy',
  'egg',
  'soy',
] as const;

export type HardRestrictionCode = (typeof HARD_RESTRICTION_CODES)[number];

// Localized labels are kept in the UI layer; here we expose the codes that
// the backend will accept. UI strings live next to the chip components.
export const DIET_LABELS: Record<DietCode, string> = {
  omnivore: 'Omnívoro',
  vegetarian: 'Vegetariano',
  vegan: 'Vegano',
  pescatarian: 'Pescatariano',
};

export const HARD_RESTRICTION_LABELS: Record<HardRestrictionCode, string> = {
  peanut: 'Maní',
  tree_nut: 'Frutos secos',
  shellfish: 'Mariscos',
  gluten: 'Gluten',
  dairy: 'Lácteos',
  egg: 'Huevo',
  soy: 'Soja',
};

export function isValidDietCode(value: unknown): value is DietCode {
  return typeof value === 'string' && (DIET_CODES as readonly string[]).includes(value);
}

export function isValidHardRestrictionCode(value: unknown): value is HardRestrictionCode {
  return typeof value === 'string' && (HARD_RESTRICTION_CODES as readonly string[]).includes(value);
}

// Type guard for the hunger union so the UI layer can validate its own
// form state against the typed enum.
export function isHungerLevel(value: string): value is HungerLevel {
  return value === 'light' || value === 'normal' || value === 'strong';
}
