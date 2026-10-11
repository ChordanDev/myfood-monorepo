import { errorFromEnvelope, type ApiError } from '@/api/errors';
import { oneOf } from '@/features/auth/fixtures/oneOf';
import type { SlotCookingTime, SlotCookingTimes } from '@/features/auth/types/auth';
import { HUNGER_LEVELS } from '../constants/preferenceOptions';
import slotCookingTimes from './slotCookingTimes.json';
import slotCookingTimesNotFound from './slotCookingTimesNotFound.json';

type FrozenSlotCookingTime = Omit<SlotCookingTime, 'hungerLevel'> & { hungerLevel: string };

function narrowSlot(slot: FrozenSlotCookingTime): SlotCookingTime {
  return { ...slot, hungerLevel: oneOf(HUNGER_LEVELS, slot.hungerLevel) };
}

// Narrows a frozen `{ breakfast, lunch, dinner }` body. Shared with the onboarding
// completion fixture, which embeds the same object.
export function narrowSlotCookingTimes(
  times: Record<keyof SlotCookingTimes, FrozenSlotCookingTime>
): SlotCookingTimes {
  return {
    breakfast: narrowSlot(times.breakfast),
    lunch: narrowSlot(times.lunch),
    dinner: narrowSlot(times.dinner),
  };
}

// The frozen body of `GET` and `PUT /api/me/slot-cooking-times`. The Hunger levels are
// narrowed here; every other field is checked against `SlotCookingTimes` by the compiler.
export function fixtureSlotCookingTimes(): SlotCookingTimes {
  return narrowSlotCookingTimes(slotCookingTimes);
}

// The frozen 404 body `GET /api/me/slot-cooking-times` answers until a set is saved.
export function fixtureSlotCookingTimesNotFound(): typeof slotCookingTimesNotFound {
  return { error: { ...slotCookingTimesNotFound.error } };
}

// That 404 as the api client throws it.
export function fixtureSlotCookingTimesNotFoundError(): ApiError {
  return errorFromEnvelope(fixtureSlotCookingTimesNotFound(), 404);
}
