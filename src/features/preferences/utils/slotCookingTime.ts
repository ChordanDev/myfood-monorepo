// Builders for one meal slot's cooking time, shared by the onboarding wizard
// and the settings screen.

import type { HungerLevel, SlotCookingTime } from '@/features/auth/types/auth';

export type SlotMode = 'noCook' | 'preset' | 'custom';

export function buildSlot(mode: SlotMode, value: number, hunger: HungerLevel): SlotCookingTime {
  // Spec contract: no cook -> 0, preset -> bucket integer, custom -> integer minutes.
  if (mode === 'noCook') {
    return { cookingTimeMinutes: 0, hungerLevel: hunger };
  }
  if (mode === 'custom') {
    const safe = Math.max(0, Math.floor(value));
    return { cookingTimeMinutes: safe, hungerLevel: hunger };
  }
  return { cookingTimeMinutes: Math.max(0, Math.floor(value)), hungerLevel: hunger };
}

export function defaultSlot(mode: SlotMode = 'noCook'): SlotCookingTime {
  return { cookingTimeMinutes: mode === 'noCook' ? 0 : 30, hungerLevel: 'normal' };
}
