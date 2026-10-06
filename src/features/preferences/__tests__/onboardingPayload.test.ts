import {
  DIET_CODES,
  HARD_RESTRICTION_CODES,
  isValidDietCode,
  isValidHardRestrictionCode,
} from '../constants/catalog';
import {
  OnboardingValidationError,
  buildOnboardingPayload,
  buildPreferencesPayload,
  buildProfilePayload,
} from '../utils/onboardingPayload';
import type { OnboardingFormState, ProfileFormState } from '../utils/onboardingPayload';

const baseState: OnboardingFormState = {
  displayName: 'Lucca',
  householdSize: 1,
  cookingSkill: 'beginner',
  preferences: {
    diet: 'omnivore',
    hardRestrictions: [],
    softPreferences: [],
  },
  slotCookingTimes: {
    breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
    lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
    dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
  },
};

describe('catalog codes', () => {
  it('exposes the four diet codes the backend catalog accepts', () => {
    expect([...DIET_CODES].sort()).toEqual(
      ['omnivore', 'pescatarian', 'vegan', 'vegetarian'].sort()
    );
  });

  it('exposes the seven hard-restriction codes the backend catalog accepts', () => {
    expect([...HARD_RESTRICTION_CODES].sort()).toEqual(
      ['dairy', 'egg', 'gluten', 'peanut', 'shellfish', 'soy', 'tree_nut'].sort()
    );
  });

  it('accepts only exact catalog codes for diet', () => {
    for (const code of DIET_CODES) {
      expect(isValidDietCode(code)).toBe(true);
    }
    expect(isValidDietCode('Omnivore')).toBe(false);
    expect(isValidDietCode('omnívoro')).toBe(false);
    expect(isValidDietCode('paleo')).toBe(false);
    expect(isValidDietCode(null)).toBe(false);
    expect(isValidDietCode(undefined)).toBe(false);
    expect(isValidDietCode(42)).toBe(false);
  });

  it('accepts only exact catalog codes for hard restrictions', () => {
    for (const code of HARD_RESTRICTION_CODES) {
      expect(isValidHardRestrictionCode(code)).toBe(true);
    }
    expect(isValidHardRestrictionCode('peanuts')).toBe(false);
    expect(isValidHardRestrictionCode('gluten-free')).toBe(false);
    expect(isValidHardRestrictionCode('Maní')).toBe(false);
    expect(isValidHardRestrictionCode(null)).toBe(false);
  });
});

describe('buildOnboardingPayload', () => {
  it('serializes diet and hardRestrictions as catalog codes only', () => {
    const payload = buildOnboardingPayload({
      ...baseState,
      preferences: {
        diet: 'pescatarian',
        hardRestrictions: ['shellfish', 'peanut'],
        softPreferences: ['cilantro', 'cilantro', '  mushrooms  ', ''],
      },
    });

    expect(payload.preferences.diet).toBe('pescatarian');
    expect(payload.preferences.hardRestrictions).toEqual(['shellfish', 'peanut']);
    // soft preferences are free-form per spec; trimmed and de-duplicated
    expect(payload.preferences.softPreferences).toEqual(['cilantro', 'mushrooms']);
  });

  it('serializes a null diet when the user picked none', () => {
    const payload = buildOnboardingPayload({
      ...baseState,
      preferences: { diet: null, hardRestrictions: [], softPreferences: [] },
    });

    expect(payload.preferences.diet).toBeNull();
    expect(payload.preferences.hardRestrictions).toEqual([]);
  });

  it('rejects an unknown diet code coming from the form', () => {
    expect(() =>
      buildOnboardingPayload({
        ...baseState,
        preferences: {
          // Simulates a stale UI that still has a free-text value.
          diet: 'paleo' as unknown as null,
          hardRestrictions: [],
          softPreferences: [],
        },
      })
    ).toThrow(OnboardingValidationError);
  });

  it('rejects an unknown hard-restriction code coming from the form', () => {
    expect(() =>
      buildOnboardingPayload({
        ...baseState,
        preferences: {
          diet: null,
          hardRestrictions: ['gluten', 'mango' as unknown as 'peanut'],
          softPreferences: [],
        },
      })
    ).toThrow(OnboardingValidationError);
  });

  it('de-duplicates hard restrictions while preserving the original order', () => {
    const payload = buildOnboardingPayload({
      ...baseState,
      preferences: {
        diet: null,
        hardRestrictions: ['peanut', 'peanut', 'soy'],
        softPreferences: [],
      },
    });

    expect(payload.preferences.hardRestrictions).toEqual(['peanut', 'soy']);
  });

  it('rejects an out-of-range household size', () => {
    expect(() => buildOnboardingPayload({ ...baseState, householdSize: 0 })).toThrow(
      OnboardingValidationError
    );
    expect(() => buildOnboardingPayload({ ...baseState, householdSize: 21 })).toThrow(
      OnboardingValidationError
    );
  });

  it('rejects an empty or oversized display name', () => {
    expect(() => buildOnboardingPayload({ ...baseState, displayName: '   ' })).toThrow(
      OnboardingValidationError
    );
    expect(() => buildOnboardingPayload({ ...baseState, displayName: 'a'.repeat(61) })).toThrow(
      OnboardingValidationError
    );
  });

  it('rejects a negative or non-integer cooking time on any slot', () => {
    expect(() =>
      buildOnboardingPayload({
        ...baseState,
        slotCookingTimes: {
          ...baseState.slotCookingTimes,
          lunch: { cookingTimeMinutes: -5, hungerLevel: 'normal' },
        },
      })
    ).toThrow(OnboardingValidationError);
  });
});

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
    ).toThrow(OnboardingValidationError);
  });
});

describe('buildProfilePayload', () => {
  const profile: ProfileFormState = {
    displayName: 'Lucca',
    householdSize: 2,
    cookingSkill: 'intermediate',
  };

  function fieldOf(state: ProfileFormState): string | null {
    try {
      buildProfilePayload(state);
      return null;
    } catch (error) {
      if (error instanceof OnboardingValidationError) return error.field;
      throw error;
    }
  }

  it('returns the profile with a trimmed display name', () => {
    expect(buildProfilePayload({ ...profile, displayName: '  Lucca Giordana ' })).toEqual({
      displayName: 'Lucca Giordana',
      householdSize: 2,
      cookingSkill: 'intermediate',
    });
  });

  it('accepts the boundaries of each rule', () => {
    expect(fieldOf({ ...profile, displayName: 'a' })).toBeNull();
    expect(fieldOf({ ...profile, displayName: 'a'.repeat(60) })).toBeNull();
    expect(fieldOf({ ...profile, householdSize: 1 })).toBeNull();
    expect(fieldOf({ ...profile, householdSize: 20 })).toBeNull();
  });

  it('rejects an empty or oversized display name', () => {
    expect(fieldOf({ ...profile, displayName: '   ' })).toBe('displayName');
    expect(fieldOf({ ...profile, displayName: 'a'.repeat(61) })).toBe('displayName');
  });

  it('rejects a household size that is missing, fractional or out of range', () => {
    expect(fieldOf({ ...profile, householdSize: null })).toBe('householdSize');
    expect(fieldOf({ ...profile, householdSize: 0 })).toBe('householdSize');
    expect(fieldOf({ ...profile, householdSize: 21 })).toBe('householdSize');
    expect(fieldOf({ ...profile, householdSize: 2.5 })).toBe('householdSize');
  });

  it('rejects a missing or unknown cooking skill', () => {
    expect(fieldOf({ ...profile, cookingSkill: null })).toBe('cookingSkill');
    expect(fieldOf({ ...profile, cookingSkill: 'chef' as unknown as null })).toBe('cookingSkill');
  });
});
