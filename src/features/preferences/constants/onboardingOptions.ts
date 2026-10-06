import type { CookingSkill, HungerLevel, MealSlot } from '@/features/auth/types/auth';

export const COOKING_SKILLS: readonly CookingSkill[] = ['beginner', 'intermediate', 'advanced'];
export const HUNGER_LEVELS: readonly HungerLevel[] = ['light', 'normal', 'strong'];
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

// Preset minute buckets shown in the UI. The spec requires serialization as
// integer minutes, so the buckets are simply integer values.
export const SLOT_PRESET_BUCKETS: readonly number[] = [0, 10, 20, 30, 45, 60];

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

export const COOKING_SKILL_LABELS: Record<CookingSkill, string> = {
  beginner: 'Estoy arrancando',
  intermediate: 'Me defiendo',
  advanced: 'Cocino seguido',
};

export const HUNGER_LEVEL_LABELS: Record<HungerLevel, string> = {
  light: 'Liviano',
  normal: 'Normal',
  strong: 'Abundante',
};
