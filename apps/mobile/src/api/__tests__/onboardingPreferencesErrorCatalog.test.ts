import {
  AUTH_ERROR_MESSAGES,
  errorFromEnvelope,
  getAuthErrorMessage,
  KNOWN_AUTH_ERROR_CODES,
  type ApiError,
} from '@/api/errors';
import { fixtureInvalidCookingSkillError } from '@/features/onboarding/fixtures/onboardingCompletion';
import {
  fixtureInvalidDietError,
  fixtureInvalidHardRestrictionError,
} from '@/features/preferences/fixtures/preferences';
import {
  fixtureInvalidHungerLevelError,
  fixtureSlotCookingTimesNotFoundError,
  fixtureValidationErrorDinnerCookingTimeMinutesError,
  fixtureValidationRequestApiError,
} from '@/features/preferences/fixtures/slotCookingTimes';

// The error codes of `POST /api/onboarding/complete`, `/api/me/preferences` and
// `/api/me/slot-cooking-times`. Each error below is built from a frozen envelope that the
// api controller tests pin by exact equality, so its code is one the api emits.
describe('error catalog of the onboarding, preferences and slot cooking times routes', () => {
  const frozenErrors: [string, number, () => ApiError][] = [
    ['validation_error', 422, fixtureValidationErrorDinnerCookingTimeMinutesError],
    ['invalid_cooking_skill', 422, fixtureInvalidCookingSkillError],
    ['invalid_diet', 422, fixtureInvalidDietError],
    ['invalid_hard_restriction', 422, fixtureInvalidHardRestrictionError],
    ['invalid_hunger_level', 422, fixtureInvalidHungerLevelError],
    ['slot_cooking_times_not_found', 404, fixtureSlotCookingTimesNotFoundError],
  ];

  // What the User reads for a code the catalog does not know.
  const unknownCodeMessage = getAuthErrorMessage(
    errorFromEnvelope({ error: { code: 'brand_new_code', message: 'x' } }, 422)
  );

  it.each(frozenErrors)('keeps %s with status %i', (code, status, frozenError) => {
    expect(frozenError()).toMatchObject({ code, status });
  });

  it.each(frozenErrors)(
    'shows the message of %s, not the generic one',
    (_code, _status, frozen) => {
      const error = frozen();
      const shown = getAuthErrorMessage(error);

      expect(shown).toBe(AUTH_ERROR_MESSAGES[error.code]);
      expect(shown).not.toBe(unknownCodeMessage);
      // The message of the envelope is the api's own wording, in English.
      expect(shown).not.toBe(error.message);
    }
  );

  it('shows a different message for each of those codes', () => {
    const shown = frozenErrors.map(([, , frozenError]) => getAuthErrorMessage(frozenError()));

    expect(new Set(shown).size).toBe(frozenErrors.length);
  });

  // `validation_error` comes in two forms: one names the field, the other names none. The
  // User reads the catalog text for the code in both, whatever the api message says.
  it('shows the same message for validation_error whether it names a field or not', () => {
    const named = fixtureValidationErrorDinnerCookingTimeMinutesError();
    const fieldless = fixtureValidationRequestApiError();

    expect(fieldless).toMatchObject({ code: 'validation_error', status: 422 });
    expect(fieldless.message).not.toBe(named.message);
    expect(getAuthErrorMessage(fieldless)).toBe(getAuthErrorMessage(named));
    expect(getAuthErrorMessage(fieldless)).toBe(AUTH_ERROR_MESSAGES.validation_error);
  });

  // No code in `apps/api/lib` emits these four; the catalog used to carry them.
  it.each([
    'onboarding_invalid',
    'onboarding_already_complete',
    'preferences_invalid',
    'slot_cooking_times_invalid',
  ])('does not know %s, a code the api never emits', (code) => {
    const allowlist: ReadonlySet<string> = KNOWN_AUTH_ERROR_CODES;

    expect(allowlist.has(code)).toBe(false);
    expect(Object.keys(AUTH_ERROR_MESSAGES)).not.toContain(code);
    expect(errorFromEnvelope({ error: { code, message: 'x' } }, 422).code).toBe('unknown_error');
  });
});
