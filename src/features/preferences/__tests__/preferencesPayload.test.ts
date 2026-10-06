import { PreferencesValidationError, buildPreferencesPayload } from '../utils/preferencesPayload';

describe('buildPreferencesPayload', () => {
  it('returns the same validation as the onboarding helper', () => {
    const payload = buildPreferencesPayload({
      diet: 'vegetarian',
      hardRestrictions: ['dairy', 'egg'],
      softPreferences: ['mushrooms'],
    });

    expect(payload).toEqual({
      diet: 'vegetarian',
      hardRestrictions: ['dairy', 'egg'],
      softPreferences: ['mushrooms'],
    });
  });

  it('rejects an unknown diet code', () => {
    expect(() =>
      buildPreferencesPayload({
        diet: 'keto' as unknown as null,
        hardRestrictions: [],
        softPreferences: [],
      })
    ).toThrow(PreferencesValidationError);
  });

  it('names the field and the reason when a code is not in the catalog', () => {
    const captureError = (state: Parameters<typeof buildPreferencesPayload>[0]) => {
      try {
        buildPreferencesPayload(state);
      } catch (error) {
        return error;
      }
      return null;
    };

    expect(
      captureError({ diet: 'keto' as unknown as null, hardRestrictions: [], softPreferences: [] })
    ).toMatchObject({
      name: 'PreferencesValidationError',
      field: 'preferences.diet',
      message: 'Unknown diet code.',
    });
    expect(
      captureError({
        diet: null,
        hardRestrictions: ['gluten', 'mango' as unknown as 'peanut'],
        softPreferences: [],
      })
    ).toMatchObject({
      name: 'PreferencesValidationError',
      field: 'preferences.hardRestrictions',
      message: 'Unknown hard restriction code: mango',
    });
  });
});
