import type { CookingSkill, CookingTimeSlot, HungerLevel } from '@/features/auth/types/auth';

export const COOKING_SKILLS: readonly CookingSkill[] = ['beginner', 'intermediate', 'advanced'];
export const HUNGER_LEVELS: readonly HungerLevel[] = ['light', 'normal', 'strong'];

// `satisfies` on the list rejects a code that is not a CookingTimeSlot. The
// `satisfies` on the export rejects the opposite drift: its target is `never`
// while the list leaves a CookingTimeSlot out.
const cookingTimeSlots = [
  'breakfast',
  'lunch',
  'dinner',
] as const satisfies readonly CookingTimeSlot[];

type MissingCookingTimeSlot = Exclude<CookingTimeSlot, (typeof cookingTimeSlots)[number]>;

type EveryCookingTimeSlot = [MissingCookingTimeSlot] extends [never]
  ? readonly CookingTimeSlot[]
  : never;

export const COOKING_TIME_SLOTS: readonly CookingTimeSlot[] =
  cookingTimeSlots satisfies EveryCookingTimeSlot;

// Preset minute buckets shown in the UI. The spec requires serialization as
// integer minutes, so the buckets are simply integer values.
export const SLOT_PRESET_BUCKETS: readonly number[] = [0, 10, 20, 30, 45, 60];

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
