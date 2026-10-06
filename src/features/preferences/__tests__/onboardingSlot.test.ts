import { slotFormToCookingTime, type SlotFormState } from '../utils/onboardingSlot';

const baseForm: SlotFormState = {
  mode: 'preset',
  preset: 30,
  customText: '',
  hunger: 'normal',
};

describe('slotFormToCookingTime', () => {
  it('serializes "no cook" as zero minutes, whatever the preset or the text hold', () => {
    expect(
      slotFormToCookingTime({ ...baseForm, mode: 'noCook', preset: 45, customText: '25' })
    ).toEqual({ cookingTimeMinutes: 0, hungerLevel: 'normal' });
  });

  it('serializes a preset as its bucket minutes', () => {
    expect(slotFormToCookingTime({ ...baseForm, mode: 'preset', preset: 45 })).toEqual({
      cookingTimeMinutes: 45,
      hungerLevel: 'normal',
    });
  });

  it('serializes manual minutes from the typed digits, ignoring the preset', () => {
    expect(
      slotFormToCookingTime({ ...baseForm, mode: 'custom', preset: 45, customText: '25' })
    ).toEqual({ cookingTimeMinutes: 25, hungerLevel: 'normal' });
  });

  it('carries the hunger level of the slot', () => {
    expect(slotFormToCookingTime({ ...baseForm, hunger: 'strong' }).hungerLevel).toBe('strong');
  });

  it('falls back to zero minutes when the manual field holds no number', () => {
    // Step validation rejects this form before submit; the serializer still
    // has to return a well-formed slot instead of NaN.
    expect(
      slotFormToCookingTime({ ...baseForm, mode: 'custom', customText: '' }).cookingTimeMinutes
    ).toBe(0);
    expect(
      slotFormToCookingTime({ ...baseForm, mode: 'custom', customText: 'abc' }).cookingTimeMinutes
    ).toBe(0);
  });
});
