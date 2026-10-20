import type { SlotCookingTimes, UserPreferences } from '@/features/auth/types/auth';
import {
  buildBudgetEdit,
  buildPreferencesEdit,
  buildSlotTimesEdit,
  createBudgetDraft,
  createPreferenceDraft,
  createProfileDraft,
  createSlotDraft,
  getSettingsDraftTitle,
  stepHouseholdSize,
  toggleHardRestriction,
} from '../utils/settingsDraft';

const savedPreferences: UserPreferences = {
  diet: 'vegetarian',
  hardRestrictions: ['gluten', 'peanut'],
  softPreferences: ['picante', 'comidas rápidas'],
};

const savedSlotTimes: SlotCookingTimes = {
  breakfast: { cookingTimeMinutes: 0, hungerLevel: 'light' },
  lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
  dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
};

describe('createProfileDraft', () => {
  const completeUser = {
    displayName: 'Lucca',
    householdSize: 2,
    cookingSkill: 'intermediate',
  } as const;

  it('starts from the saved profile and asks only for the edited field', () => {
    expect(createProfileDraft(completeUser, 'householdSize')).toEqual({
      kind: 'profile',
      field: 'householdSize',
      missingFields: [],
      values: { displayName: 'Lucca', householdSize: 2, cookingSkill: 'intermediate' },
    });
  });

  it('also asks for the other fields the stored profile does not have', () => {
    const draft = createProfileDraft(
      { displayName: 'Lucca', householdSize: null, cookingSkill: null },
      'displayName'
    );

    expect(draft.missingFields).toEqual(['householdSize', 'cookingSkill']);
    expect(draft.values).toEqual({ displayName: 'Lucca', householdSize: null, cookingSkill: null });
  });

  it('treats a blank name as missing, but never lists the edited field', () => {
    const user = { displayName: '  ', householdSize: null, cookingSkill: 'advanced' } as const;

    expect(createProfileDraft(user, 'cookingSkill').missingFields).toEqual([
      'displayName',
      'householdSize',
    ]);
    expect(createProfileDraft(user, 'householdSize').missingFields).toEqual(['displayName']);
    expect(
      createProfileDraft({ ...user, displayName: null }, 'displayName').values.displayName
    ).toBe('');
  });
});

describe('stepHouseholdSize', () => {
  it('moves one person at a time', () => {
    expect(stepHouseholdSize(2, 1)).toBe(3);
    expect(stepHouseholdSize(2, -1)).toBe(1);
  });

  it('stays between 1 and 20', () => {
    expect(stepHouseholdSize(1, -1)).toBe(1);
    expect(stepHouseholdSize(20, 1)).toBe(20);
  });

  it('starts at one person when the size is unknown', () => {
    expect(stepHouseholdSize(null, 1)).toBe(1);
    expect(stepHouseholdSize(null, -1)).toBe(1);
  });
});

describe('createPreferenceDraft', () => {
  it('starts each editor from the saved value', () => {
    expect(createPreferenceDraft('diet', savedPreferences)).toEqual({
      kind: 'diet',
      diet: 'vegetarian',
    });
    expect(createPreferenceDraft('hardRestrictions', savedPreferences)).toEqual({
      kind: 'hardRestrictions',
      selected: ['gluten', 'peanut'],
      unknownCodes: [],
    });
    expect(createPreferenceDraft('softPreferences', savedPreferences)).toEqual({
      kind: 'softPreferences',
      text: 'picante, comidas rápidas',
    });
  });

  it('shows no diet selected when the saved code is not in the catalog', () => {
    expect(createPreferenceDraft('diet', { ...savedPreferences, diet: 'keto' })).toEqual({
      kind: 'diet',
      diet: null,
    });
  });

  it('sets aside the restriction codes the catalog does not know', () => {
    expect(
      createPreferenceDraft('hardRestrictions', {
        ...savedPreferences,
        hardRestrictions: ['sesame', 'gluten'],
      })
    ).toEqual({ kind: 'hardRestrictions', selected: ['gluten'], unknownCodes: ['sesame'] });
  });
});

describe('toggleHardRestriction', () => {
  it('adds a missing code and removes a selected one', () => {
    expect(toggleHardRestriction(['gluten'], 'egg')).toEqual(['gluten', 'egg']);
    expect(toggleHardRestriction(['gluten', 'egg'], 'gluten')).toEqual(['egg']);
  });
});

describe('buildPreferencesEdit', () => {
  it('changes only the diet', () => {
    expect(buildPreferencesEdit({ kind: 'diet', diet: 'vegan' }, savedPreferences)).toEqual({
      ...savedPreferences,
      diet: 'vegan',
    });
    expect(buildPreferencesEdit({ kind: 'diet', diet: null }, savedPreferences)).toEqual({
      ...savedPreferences,
      diet: null,
    });
  });

  it('changes only the hard restrictions', () => {
    expect(
      buildPreferencesEdit(
        { kind: 'hardRestrictions', selected: ['egg'], unknownCodes: [] },
        savedPreferences
      )
    ).toEqual({ ...savedPreferences, hardRestrictions: ['egg'] });
  });

  it('keeps the restrictions it could not show, so an edit never drops one', () => {
    expect(
      buildPreferencesEdit(
        { kind: 'hardRestrictions', selected: ['egg'], unknownCodes: ['sesame'] },
        { ...savedPreferences, hardRestrictions: ['sesame', 'gluten'] }
      ).hardRestrictions
    ).toEqual(['egg', 'sesame']);
  });

  it('changes only the soft preferences, parsed from the comma list', () => {
    expect(
      buildPreferencesEdit(
        { kind: 'softPreferences', text: ' cilantro, , picante,cilantro ' },
        savedPreferences
      )
    ).toEqual({ ...savedPreferences, softPreferences: ['cilantro', 'picante'] });
  });

  it('passes through untouched fields the catalog does not know', () => {
    const saved = { ...savedPreferences, diet: 'keto', hardRestrictions: ['sesame'] };

    expect(buildPreferencesEdit({ kind: 'softPreferences', text: '' }, saved)).toEqual({
      diet: 'keto',
      hardRestrictions: ['sesame'],
      softPreferences: [],
    });
  });
});

describe('createSlotDraft', () => {
  it('starts from the saved slot and offers the preset times', () => {
    expect(createSlotDraft('lunch', savedSlotTimes)).toEqual({
      kind: 'slot',
      slot: 'lunch',
      value: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
      minuteOptions: [0, 10, 20, 30, 45, 60],
    });
  });

  it('also offers a saved time that is not a preset', () => {
    const draft = createSlotDraft('dinner', {
      ...savedSlotTimes,
      dinner: { cookingTimeMinutes: 25, hungerLevel: 'strong' },
    });

    expect(draft.minuteOptions).toEqual([0, 10, 20, 25, 30, 45, 60]);
  });
});

describe('buildSlotTimesEdit', () => {
  it('changes only the edited slot', () => {
    expect(
      buildSlotTimesEdit(
        {
          kind: 'slot',
          slot: 'lunch',
          value: { cookingTimeMinutes: 60, hungerLevel: 'strong' },
          minuteOptions: [],
        },
        savedSlotTimes
      )
    ).toEqual({
      breakfast: savedSlotTimes.breakfast,
      lunch: { cookingTimeMinutes: 60, hungerLevel: 'strong' },
      dinner: savedSlotTimes.dinner,
    });
  });
});

describe('getSettingsDraftTitle', () => {
  it('names the sheet after the row that opened it', () => {
    expect(
      getSettingsDraftTitle(
        createProfileDraft(
          { displayName: null, householdSize: null, cookingSkill: null },
          'householdSize'
        )
      )
    ).toBe('Personas en casa');
    expect(getSettingsDraftTitle(createPreferenceDraft('hardRestrictions', savedPreferences))).toBe(
      'Restricciones duras'
    );
    expect(getSettingsDraftTitle(createSlotDraft('dinner', savedSlotTimes))).toBe('Cena');
    expect(getSettingsDraftTitle(createBudgetDraft(savedBudget))).toBe('Presupuesto semanal');
  });
});

const savedBudget = {
  weeklyBudgetCents: 4500000,
  isDefault: true,
  minWeeklyBudgetCents: 3000000,
  currency: 'ARS',
};

describe('createBudgetDraft', () => {
  it('starts from the saved Budget in whole pesos and keeps the minimum', () => {
    expect(createBudgetDraft(savedBudget)).toEqual({
      kind: 'budget',
      text: '45000',
      savedWeeklyBudgetCents: 4500000,
      minWeeklyBudgetCents: 3000000,
    });
  });
});

describe('buildBudgetEdit', () => {
  const draft = (text: string) => ({ ...createBudgetDraft(savedBudget), text });

  it('turns the pesos typed into the cents the endpoint takes', () => {
    expect(buildBudgetEdit(draft('60000'))).toEqual({
      ok: true,
      payload: { weeklyBudgetCents: 6000000 },
    });
  });

  it('accepts surrounding spaces and thousands dots', () => {
    expect(buildBudgetEdit(draft(' 60.000 '))).toEqual({
      ok: true,
      payload: { weeklyBudgetCents: 6000000 },
    });
  });

  it('has nothing to save when the amount is the one already saved', () => {
    // So a default the owner did not change keeps following the tier.
    expect(buildBudgetEdit(draft('45000'))).toEqual({ ok: true, payload: null });
    expect(buildBudgetEdit(draft(' 45.000 '))).toEqual({ ok: true, payload: null });
  });

  it('accepts exactly the minimum', () => {
    expect(buildBudgetEdit(draft('30000'))).toEqual({
      ok: true,
      payload: { weeklyBudgetCents: 3000000 },
    });
  });

  it('refuses an amount below the minimum and names it', () => {
    expect(buildBudgetEdit(draft('29999'))).toEqual({
      ok: false,
      message: 'Ingresá $30.000 o más.',
    });
  });

  it.each(['', '0', 'abc', '450,50', '-100', '12.5'])('refuses %p as an amount', (text) => {
    expect(buildBudgetEdit({ ...draft(text), minWeeklyBudgetCents: 0 })).toEqual({
      ok: false,
      message: 'Ingresá un monto en pesos, sin centavos.',
    });
  });

  it('refuses an amount past what the server stores', () => {
    expect(buildBudgetEdit({ ...draft('21474837'), minWeeklyBudgetCents: 0 })).toEqual({
      ok: false,
      message: 'Ingresá un monto menor.',
    });
  });
});
