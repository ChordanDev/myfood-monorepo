import { errorFromEnvelope, type ApiError } from '@/api/errors';
import { oneOf } from '@/features/auth/fixtures/oneOf';
import type { SlotCookingTime, SlotCookingTimes } from '@/features/auth/types/auth';
import { HUNGER_LEVELS } from '../constants/preferenceOptions';
import invalidHungerLevel from './invalidHungerLevel.json';
import slotCookingTimes from './slotCookingTimes.json';
import slotCookingTimesNotFound from './slotCookingTimesNotFound.json';
import validationError from './validationError.json';
import validationErrorDinnerCookingTimeMinutes from './validationErrorDinnerCookingTimeMinutes.json';

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

// The frozen 422 body `PUT /api/me/slot-cooking-times` and `POST /api/onboarding/complete`
// answer to a Hunger level outside the catalog.
export function fixtureInvalidHungerLevel(): typeof invalidHungerLevel {
  return { error: { ...invalidHungerLevel.error } };
}

// That 422 as the api client throws it.
export function fixtureInvalidHungerLevelError(): ApiError {
  return errorFromEnvelope(fixtureInvalidHungerLevel(), 422);
}

// The frozen 422 body the same two routes answer to dinner minutes of -1: `validation_error`
// in the form that names the field.
export function fixtureValidationErrorDinnerCookingTimeMinutes(): typeof validationErrorDinnerCookingTimeMinutes {
  return { error: { ...validationErrorDinnerCookingTimeMinutes.error } };
}

// That 422 as the api client throws it.
export function fixtureValidationErrorDinnerCookingTimeMinutesError(): ApiError {
  return errorFromEnvelope(fixtureValidationErrorDinnerCookingTimeMinutes(), 422);
}

// The frozen 422 body `PUT /api/me/slot-cooking-times` answers to a body that is not a JSON
// object: `validation_error` in the form that names no field.
export function fixtureValidationRequest(): typeof validationError {
  return { error: { ...validationError.error } };
}

// That 422 as the api client throws it.
export function fixtureValidationRequestApiError(): ApiError {
  return errorFromEnvelope(fixtureValidationRequest(), 422);
}
