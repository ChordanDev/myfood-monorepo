import type { HungerLevel, SlotCookingTime } from '@/features/auth/types/auth';
import { SLOT_PRESET_BUCKETS } from '@/features/preferences/constants/onboardingOptions';

export type SlotMode = 'noCook' | 'preset' | 'custom';

export interface SlotFormState {
  mode: SlotMode;
  preset: number;
  customText: string;
  hunger: HungerLevel;
}

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

// Serializes one slot of the form into the payload shape. Manual minutes that
// are not a number serialize as 0; `validateOnboardingStep` rejects that form
// before it can be submitted.
export function slotFormToCookingTime(form: SlotFormState): SlotCookingTime {
  if (form.mode === 'noCook') {
    return buildSlot('noCook', 0, form.hunger);
  }
  if (form.mode === 'custom') {
    const parsed = Number.parseInt(form.customText, 10);
    return buildSlot('custom', Number.isFinite(parsed) ? parsed : 0, form.hunger);
  }
  return buildSlot('preset', form.preset, form.hunger);
}

export function defaultSlot(mode: SlotMode = 'noCook'): SlotCookingTime {
  return { cookingTimeMinutes: mode === 'noCook' ? 0 : 30, hungerLevel: 'normal' };
}

export function buildSlotForm(slot: SlotCookingTime): SlotFormState {
  if (slot.cookingTimeMinutes === 0) {
    return { mode: 'noCook', preset: 30, customText: '', hunger: slot.hungerLevel };
  }
  if (SLOT_PRESET_BUCKETS.includes(slot.cookingTimeMinutes)) {
    return {
      mode: 'preset',
      preset: slot.cookingTimeMinutes,
      customText: '',
      hunger: slot.hungerLevel,
    };
  }
  return {
    mode: 'custom',
    preset: 30,
    customText: String(slot.cookingTimeMinutes),
    hunger: slot.hungerLevel,
  };
}
