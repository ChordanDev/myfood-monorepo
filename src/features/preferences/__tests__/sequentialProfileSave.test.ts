import { runSequentialProfileSave } from '../utils/sequentialProfileSave';

describe('runSequentialProfileSave (Judgment Day S3)', () => {
  it('runs preferences then slots in order and returns both updated payloads', async () => {
    const callOrder: string[] = [];
    const savePreferences = jest.fn(async () => {
      callOrder.push('preferences');
      return { diet: 'vegan', hardRestrictions: ['soy'], softPreferences: [] };
    });
    const saveSlots = jest.fn(async () => {
      callOrder.push('slots');
      return {
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
        dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
      };
    });

    const result = await runSequentialProfileSave({ savePreferences, saveSlots });

    expect(callOrder).toEqual(['preferences', 'slots']);
    expect(result.step).toBe('done');
    expect(result.error).toBeUndefined();
    expect(result.updatedPreferences).toEqual({
      diet: 'vegan',
      hardRestrictions: ['soy'],
      softPreferences: [],
    });
    expect(result.updatedSlots).toBeDefined();
  });

  it('returns step=preferences with the error and never calls saveSlots when preferences fails', async () => {
    const savePreferences = jest.fn().mockRejectedValue(new Error('preferences_invalid'));
    const saveSlots = jest.fn();

    const result = await runSequentialProfileSave({ savePreferences, saveSlots });

    expect(result.step).toBe('preferences');
    expect((result.error as Error).message).toBe('preferences_invalid');
    expect(saveSlots).not.toHaveBeenCalled();
  });

  it('returns step=slots with the preferences payload + error when slots fail', async () => {
    const savePreferences = jest
      .fn()
      .mockResolvedValue({ diet: 'vegetarian', hardRestrictions: [], softPreferences: [] });
    const saveSlots = jest.fn().mockRejectedValue(new Error('slot_cooking_times_invalid'));

    const result = await runSequentialProfileSave({ savePreferences, saveSlots });

    expect(result.step).toBe('slots');
    expect((result.error as Error).message).toBe('slot_cooking_times_invalid');
    // Preferences persisted; the caller can show that explicitly so the
    // user can retry without re-applying the first PUT.
    expect(result.updatedPreferences).toEqual({
      diet: 'vegetarian',
      hardRestrictions: [],
      softPreferences: [],
    });
  });
});
