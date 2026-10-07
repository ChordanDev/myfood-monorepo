import type { HungerLevel, SlotCookingTime } from '@/features/auth/types/auth';
import { SLOT_PRESET_BUCKETS } from '@/features/preferences/constants/preferenceOptions';
import { buildSlot, type SlotMode } from '@/features/preferences/utils/slotCookingTime';

// The slot builders are shared with the settings screen and live in the
// preferences feature; this module keeps the wizard's form state. `SlotMode`
// is re-exported because it is part of that form state.
export type { SlotMode };

export interface SlotFormState {
  mode: SlotMode;
  preset: number;
  customText: string;
  hunger: HungerLevel;
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
