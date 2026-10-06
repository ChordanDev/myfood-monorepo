import {
  formatCookingSkillSummary,
  formatDietSummary,
  formatDisplayNameSummary,
  formatHardRestrictionsSummary,
  formatHouseholdSummary,
  formatPlanSummary,
  formatSlotSummary,
  formatSoftPreferencesSummary,
  formatTrialPill,
  getInitials,
  getTrialState,
} from '../utils/settingsFormatters';

describe('getInitials', () => {
  it('takes the first letter of the first two words of the display name', () => {
    expect(getInitials('Lucca Giordana', 'lucca@x.com')).toBe('LG');
  });

  it('returns a single letter for a one-word name', () => {
    expect(getInitials('lucca', 'someone@x.com')).toBe('L');
  });

  it('never returns more than two letters', () => {
    expect(getInitials('Ana María López', 'ana@x.com')).toBe('AM');
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(getInitials('  lucca   giordana ', 'lucca@x.com')).toBe('LG');
  });

  it('falls back to the first letter of the email when there is no name', () => {
    expect(getInitials(null, 'lucca@x.com')).toBe('L');
    expect(getInitials('   ', 'maria@x.com')).toBe('M');
  });
});

const NOW = new Date('2026-10-06T12:00:00Z');

describe('getTrialState', () => {
  const notInTrial = { isInTrial: false, daysLeft: 0 };

  it('is in trial when there is no subscription and the trial ends in the future', () => {
    expect(
      getTrialState({ subscriptionStatus: 'none', trialEndsAt: '2026-10-12T12:00:00Z' }, NOW)
    ).toEqual({ isInTrial: true, daysLeft: 6 });
  });

  it('rounds a partial day up', () => {
    expect(
      getTrialState({ subscriptionStatus: 'none', trialEndsAt: '2026-10-06T12:00:01Z' }, NOW)
    ).toEqual({ isInTrial: true, daysLeft: 1 });
    expect(
      getTrialState({ subscriptionStatus: 'none', trialEndsAt: '2026-10-11T13:00:00Z' }, NOW)
    ).toEqual({ isInTrial: true, daysLeft: 6 });
  });

  it('is not in trial once the end date is reached or passed', () => {
    expect(
      getTrialState({ subscriptionStatus: 'none', trialEndsAt: '2026-10-06T12:00:00Z' }, NOW)
    ).toEqual(notInTrial);
    expect(
      getTrialState({ subscriptionStatus: 'none', trialEndsAt: '2026-10-01T00:00:00Z' }, NOW)
    ).toEqual(notInTrial);
  });

  it('is not in trial without a usable end date', () => {
    expect(getTrialState({ subscriptionStatus: 'none', trialEndsAt: null }, NOW)).toEqual(
      notInTrial
    );
    expect(getTrialState({ subscriptionStatus: 'none', trialEndsAt: 'not-a-date' }, NOW)).toEqual(
      notInTrial
    );
  });

  it.each(['active', 'past_due', 'canceled'] as const)(
    'is not in trial when the subscription is %s, even with a future end date',
    (subscriptionStatus) => {
      expect(
        getTrialState({ subscriptionStatus, trialEndsAt: '2026-10-12T12:00:00Z' }, NOW)
      ).toEqual(notInTrial);
    }
  );
});

describe('formatTrialPill', () => {
  it('shows the days left in plural', () => {
    expect(formatTrialPill({ isInTrial: true, daysLeft: 6 })).toBe('Prueba · 6 días');
  });

  it('uses the singular for one day', () => {
    expect(formatTrialPill({ isInTrial: true, daysLeft: 1 })).toBe('Prueba · 1 día');
  });

  it('has no label outside the trial', () => {
    expect(formatTrialPill({ isInTrial: false, daysLeft: 0 })).toBeNull();
  });
});

describe('formatPlanSummary', () => {
  // Trial dates are built from local-time parts on purpose: the summary
  // shows the day on the user's own calendar, so these assertions hold
  // in whatever timezone the suite runs.
  const localIso = (month: number, day: number, hour = 12, minute = 0) =>
    new Date(2026, month, day, hour, minute).toISOString();
  const localNow = new Date(2026, 9, 6, 12, 0);

  it('shows the trial end date while in trial', () => {
    expect(
      formatPlanSummary(
        { type: 'individual', subscriptionStatus: 'none', trialEndsAt: localIso(9, 12) },
        localNow
      )
    ).toBe('Individual · prueba hasta 12 Oct');
  });

  it('uses the local calendar day at both edges of the day', () => {
    const account = { type: 'individual', subscriptionStatus: 'none' } as const;
    expect(formatPlanSummary({ ...account, trialEndsAt: localIso(9, 12, 0, 30) }, localNow)).toBe(
      'Individual · prueba hasta 12 Oct'
    );
    expect(formatPlanSummary({ ...account, trialEndsAt: localIso(9, 12, 23, 30) }, localNow)).toBe(
      'Individual · prueba hasta 12 Oct'
    );
  });

  it.each([
    [0, 'Ene'],
    [1, 'Feb'],
    [2, 'Mar'],
    [3, 'Abr'],
    [4, 'May'],
    [5, 'Jun'],
    [6, 'Jul'],
    [7, 'Ago'],
    [8, 'Sep'],
    [9, 'Oct'],
    [10, 'Nov'],
    [11, 'Dic'],
  ])('abbreviates month %i as %s', (month, abbreviation) => {
    expect(
      formatPlanSummary(
        { type: 'individual', subscriptionStatus: 'none', trialEndsAt: localIso(month, 5) },
        new Date(2025, 11, 31)
      )
    ).toBe(`Individual · prueba hasta 5 ${abbreviation}`);
  });

  it('reports an expired trial', () => {
    expect(
      formatPlanSummary(
        { type: 'individual', subscriptionStatus: 'none', trialEndsAt: localIso(9, 1) },
        localNow
      )
    ).toBe('Individual · prueba finalizada');
  });

  it('shows only the plan name when the account never had a trial date', () => {
    expect(
      formatPlanSummary(
        { type: 'individual', subscriptionStatus: 'none', trialEndsAt: null },
        localNow
      )
    ).toBe('Individual');
  });

  it.each([
    ['active', 'Individual · activa'],
    ['past_due', 'Individual · pago pendiente'],
    ['canceled', 'Individual · cancelada'],
  ] as const)('describes a %s subscription', (subscriptionStatus, expected) => {
    expect(
      formatPlanSummary(
        { type: 'individual', subscriptionStatus, trialEndsAt: localIso(9, 12) },
        localNow
      )
    ).toBe(expected);
  });

  it.each([
    ['family', 'Familiar · activa'],
    ['family_plus', 'Familiar Plus · activa'],
  ] as const)('labels the %s account type in Spanish', (type, expected) => {
    expect(
      formatPlanSummary({ type, subscriptionStatus: 'active', trialEndsAt: null }, localNow)
    ).toBe(expected);
  });
});

describe('formatDisplayNameSummary', () => {
  it('shows the trimmed name', () => {
    expect(formatDisplayNameSummary('Lucca')).toBe('Lucca');
    expect(formatDisplayNameSummary('  Lucca Giordana ')).toBe('Lucca Giordana');
  });

  it('shows a placeholder when there is no name', () => {
    expect(formatDisplayNameSummary(null)).toBe('Sin definir');
    expect(formatDisplayNameSummary('   ')).toBe('Sin definir');
  });
});

describe('formatHouseholdSummary', () => {
  it('uses the singular for one person and the plural otherwise', () => {
    expect(formatHouseholdSummary(1)).toBe('1 comensal');
    expect(formatHouseholdSummary(2)).toBe('2 comensales');
    expect(formatHouseholdSummary(20)).toBe('20 comensales');
  });

  it('shows a placeholder when the size is unknown', () => {
    expect(formatHouseholdSummary(null)).toBe('Sin definir');
  });
});

describe('formatCookingSkillSummary', () => {
  it.each([
    ['beginner', 'Estoy arrancando'],
    ['intermediate', 'Me defiendo'],
    ['advanced', 'Cocino seguido'],
  ] as const)('labels %s as "%s"', (skill, label) => {
    expect(formatCookingSkillSummary(skill)).toBe(label);
  });

  it('shows a placeholder when the skill is unknown', () => {
    expect(formatCookingSkillSummary(null)).toBe('Sin definir');
  });
});

describe('formatSlotSummary', () => {
  it('shows the cooking minutes and the hunger label', () => {
    expect(formatSlotSummary({ cookingTimeMinutes: 30, hungerLevel: 'normal' })).toBe(
      '30 min · Normal'
    );
    expect(formatSlotSummary({ cookingTimeMinutes: 45, hungerLevel: 'strong' })).toBe(
      '45 min · Abundante'
    );
  });

  it('says the user does not cook when the slot has zero minutes', () => {
    expect(formatSlotSummary({ cookingTimeMinutes: 0, hungerLevel: 'light' })).toBe(
      'No cocino · Liviano'
    );
  });
});

describe('formatDietSummary', () => {
  it.each([
    ['omnivore', 'Omnívoro'],
    ['vegetarian', 'Vegetariano'],
    ['vegan', 'Vegano'],
    ['pescatarian', 'Pescatariano'],
  ])('labels %s as "%s"', (diet, label) => {
    expect(formatDietSummary(diet)).toBe(label);
  });

  it('shows a placeholder when no diet was picked', () => {
    expect(formatDietSummary(null)).toBe('Sin preferencia');
  });

  it('never prints a code the catalog does not know', () => {
    expect(formatDietSummary('keto')).toBe('Sin preferencia');
  });
});

describe('formatHardRestrictionsSummary', () => {
  it('joins the catalog labels with a comma', () => {
    expect(formatHardRestrictionsSummary(['gluten', 'peanut'])).toBe('Gluten, Maní');
    expect(formatHardRestrictionsSummary(['tree_nut'])).toBe('Frutos secos');
  });

  it('shows a placeholder when there are none', () => {
    expect(formatHardRestrictionsSummary([])).toBe('Ninguna');
  });

  it('counts the codes the catalog does not know instead of printing them', () => {
    expect(formatHardRestrictionsSummary(['gluten', 'sesame'])).toBe('Gluten +1');
    expect(formatHardRestrictionsSummary(['sesame', 'gluten', 'peanut', 'kiwi'])).toBe(
      'Gluten, Maní +2'
    );
  });

  it('never reads as "none" when every code is unknown', () => {
    expect(formatHardRestrictionsSummary(['sesame'])).toBe('+1');
    expect(formatHardRestrictionsSummary(['sesame', 'kiwi'])).toBe('+2');
  });
});

describe('formatSoftPreferencesSummary', () => {
  it('joins the free-form preferences with a comma', () => {
    expect(formatSoftPreferencesSummary(['picante', 'comidas rápidas'])).toBe(
      'picante, comidas rápidas'
    );
  });

  it('shows a placeholder when there are none', () => {
    expect(formatSoftPreferencesSummary([])).toBe('Ninguna');
  });
});
