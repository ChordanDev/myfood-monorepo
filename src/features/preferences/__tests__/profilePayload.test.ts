import { PreferencesValidationError } from '../utils/preferencesPayload';
import { buildProfilePayload } from '../utils/profilePayload';
import type { ProfileFormState } from '../utils/profilePayload';

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
      if (error instanceof PreferencesValidationError) return error.field;
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
