import type { CookingSkill, HungerLevel } from '@/features/auth/types/auth';
import type { DietCode, HardRestrictionCode } from '@/features/preferences/constants/catalog';
import type { SlotFormState } from '../utils/onboardingSlot';
import {
  ONBOARDING_STEPS,
  clampHouseholdSize,
  getNextStep,
  getPreviousStep,
  getStepNumber,
  validateOnboardingStep,
  type OnboardingDraft,
} from '../utils/onboardingSteps';

const noCookSlot: SlotFormState = { mode: 'noCook', preset: 30, customText: '', hunger: 'normal' };

const validDraft: OnboardingDraft = {
  displayName: 'Lucca',
  householdSize: 2,
  cookingSkill: 'intermediate',
  diet: null,
  hardRestrictions: [],
  softPreferences: '',
  slots: { breakfast: noCookSlot, lunch: noCookSlot, dinner: noCookSlot },
};

function withLunch(slot: Partial<SlotFormState>): OnboardingDraft {
  return { ...validDraft, slots: { ...validDraft.slots, lunch: { ...noCookSlot, ...slot } } };
}

describe('onboarding step order', () => {
  it('runs household, preferences and meal times, in that order', () => {
    expect(ONBOARDING_STEPS).toEqual(['household', 'preferences', 'mealTimes']);
  });

  it('numbers the steps from 1 for the progress label', () => {
    expect(ONBOARDING_STEPS.map(getStepNumber)).toEqual([1, 2, 3]);
  });

  it('moves forward one step at a time and stops after the last one', () => {
    expect(getNextStep('household')).toBe('preferences');
    expect(getNextStep('preferences')).toBe('mealTimes');
    expect(getNextStep('mealTimes')).toBeNull();
  });

  it('moves back one step at a time and stops before the first one', () => {
    expect(getPreviousStep('mealTimes')).toBe('preferences');
    expect(getPreviousStep('preferences')).toBe('household');
    expect(getPreviousStep('household')).toBeNull();
  });
});

describe('clampHouseholdSize', () => {
  it('keeps a size inside 1-20 untouched', () => {
    expect(clampHouseholdSize(1)).toBe(1);
    expect(clampHouseholdSize(7)).toBe(7);
    expect(clampHouseholdSize(20)).toBe(20);
  });

  it('stops at 1 going down and at 20 going up', () => {
    expect(clampHouseholdSize(0)).toBe(1);
    expect(clampHouseholdSize(-3)).toBe(1);
    expect(clampHouseholdSize(21)).toBe(20);
  });

  it('returns a whole number of people', () => {
    expect(clampHouseholdSize(2.7)).toBe(2);
    expect(clampHouseholdSize(Number.NaN)).toBe(1);
  });
});

describe('validateOnboardingStep — household', () => {
  it('accepts a name, a size and a skill inside their limits', () => {
    expect(validateOnboardingStep('household', validDraft)).toBeNull();
  });

  it('asks for a name when it is empty or only spaces', () => {
    expect(validateOnboardingStep('household', { ...validDraft, displayName: '' })).toBe(
      'Escribí un nombre para mostrar.'
    );
    expect(validateOnboardingStep('household', { ...validDraft, displayName: '   ' })).toBe(
      'Escribí un nombre para mostrar.'
    );
  });

  it('measures the name after trimming: 60 characters pass, 61 do not', () => {
    const sixty = 'a'.repeat(60);
    expect(
      validateOnboardingStep('household', { ...validDraft, displayName: `  ${sixty}  ` })
    ).toBeNull();
    expect(validateOnboardingStep('household', { ...validDraft, displayName: `${sixty}a` })).toBe(
      'El nombre puede tener hasta 60 caracteres.'
    );
  });

  it('rejects a household size outside 1-20 or that is not a whole number', () => {
    for (const householdSize of [0, 21, 2.5, Number.NaN]) {
      expect(validateOnboardingStep('household', { ...validDraft, householdSize })).toBe(
        'Indicá entre 1 y 20 personas en casa.'
      );
    }
  });

  it('rejects a cooking skill that is not one of the options', () => {
    expect(
      validateOnboardingStep('household', {
        ...validDraft,
        cookingSkill: 'chef' as CookingSkill,
      })
    ).toBe('Elegí tu experiencia cocinando.');
  });

  it('does not look at the other steps', () => {
    expect(validateOnboardingStep('household', withLunch({ mode: 'custom' }))).toBeNull();
  });
});

describe('validateOnboardingStep — preferences', () => {
  it('accepts no diet, no restrictions and no soft preferences', () => {
    expect(validateOnboardingStep('preferences', validDraft)).toBeNull();
  });

  it('accepts catalog codes and free-text soft preferences', () => {
    expect(
      validateOnboardingStep('preferences', {
        ...validDraft,
        diet: 'vegan',
        hardRestrictions: ['gluten', 'soy'],
        softPreferences: 'cilantro, picante',
      })
    ).toBeNull();
  });

  it('rejects a diet that is not in the catalog', () => {
    expect(
      validateOnboardingStep('preferences', { ...validDraft, diet: 'paleo' as DietCode })
    ).toBe('Elegí una dieta de la lista.');
  });

  it('rejects a hard restriction that is not in the catalog', () => {
    expect(
      validateOnboardingStep('preferences', {
        ...validDraft,
        hardRestrictions: ['gluten', 'sugar' as HardRestrictionCode],
      })
    ).toBe('Revisá las restricciones seleccionadas.');
  });
});

describe('validateOnboardingStep — meal times', () => {
  it('accepts every slot on "no cook"', () => {
    expect(validateOnboardingStep('mealTimes', validDraft)).toBeNull();
  });

  it('accepts a quick preset above zero and manual minutes of at least 1', () => {
    expect(
      validateOnboardingStep('mealTimes', withLunch({ mode: 'preset', preset: 45 }))
    ).toBeNull();
    expect(
      validateOnboardingStep('mealTimes', withLunch({ mode: 'custom', customText: '1' }))
    ).toBeNull();
  });

  it('rejects a quick preset of zero or outside the buckets', () => {
    for (const preset of [0, 25]) {
      expect(validateOnboardingStep('mealTimes', withLunch({ mode: 'preset', preset }))).toBe(
        'Almuerzo: elegí un tiempo rápido de la lista.'
      );
    }
  });

  it('rejects manual minutes that are empty, zero or not only digits', () => {
    for (const customText of ['', '0', '00', 'abc', '12a', '1.5', '-5', ' 10']) {
      expect(validateOnboardingStep('mealTimes', withLunch({ mode: 'custom', customText }))).toBe(
        'Almuerzo: ingresá los minutos, con un mínimo de 1.'
      );
    }
  });

  it('rejects a hunger level that is not one of the options', () => {
    expect(validateOnboardingStep('mealTimes', withLunch({ hunger: 'huge' as HungerLevel }))).toBe(
      'Almuerzo: elegí el nivel de hambre.'
    );
  });

  it('names the first slot with a problem, in meal order', () => {
    const draft: OnboardingDraft = {
      ...validDraft,
      slots: {
        breakfast: noCookSlot,
        lunch: { ...noCookSlot, mode: 'custom' },
        dinner: { ...noCookSlot, mode: 'custom' },
      },
    };
    expect(validateOnboardingStep('mealTimes', draft)).toBe(
      'Almuerzo: ingresá los minutos, con un mínimo de 1.'
    );
  });
});
