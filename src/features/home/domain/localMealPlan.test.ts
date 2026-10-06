import type { MealPlanEntry, MealType } from '@/types/domain';
import {
  buildLocalMealPlanByDate,
  getDefaultHomeMealType,
  getPendingConfirmationEntries,
  getPendingHomeMealType,
  isMealConfirmed,
  isPendingConfirmationDate,
  isSelectableMealDate,
} from './localMealPlan';
import { formatDateKey, parseDateKey, startOfDay } from '../utils/calendarDate';

describe('mock meal plan date keys', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 25, 0, 30));
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps today selectable using the local calendar date', () => {
    let mockMealPlan: typeof import('@/mocks/domainMocks').MOCK_MEAL_PLAN;

    jest.isolateModules(() => {
      ({ MOCK_MEAL_PLAN: mockMealPlan } = jest.requireActual('@/mocks/domainMocks'));
    });

    const today = startOfDay(new Date());
    const todayKey = formatDateKey(today);
    const planByDate = buildLocalMealPlanByDate(mockMealPlan!);

    expect(todayKey).toBe('2026-08-25');
    expect(mockMealPlan![0].date).toBe(todayKey);
    expect(isSelectableMealDate(todayKey, planByDate, today, parseDateKey)).toBe(true);
  });
});

describe('getDefaultHomeMealType', () => {
  function buildEntry(type: MealType, isCooked = false): MealPlanEntry {
    return { id: `entry-${type}`, date: '2026-08-25', type, recipeId: `recipe-${type}`, isCooked };
  }

  function at(hours: number, minutes = 0) {
    return new Date(2026, 7, 25, hours, minutes);
  }

  it('picks the closest meal type when none is cooked', () => {
    const entries = [buildEntry('desayuno'), buildEntry('almuerzo'), buildEntry('cena')];

    expect(getDefaultHomeMealType(entries, at(7))).toBe('desayuno');
    expect(getDefaultHomeMealType(entries, at(14))).toBe('almuerzo');
    expect(getDefaultHomeMealType(entries, at(19))).toBe('cena');
  });

  it('skips a cooked lunch at 14:00 and picks dinner', () => {
    const entries = [
      buildEntry('desayuno', true),
      buildEntry('almuerzo', true),
      buildEntry('cena'),
    ];

    expect(getDefaultHomeMealType(entries, at(14))).toBe('cena');
  });

  it('picks the closest uncooked meal type even when a cooked one is nearer', () => {
    const entries = [buildEntry('desayuno'), buildEntry('almuerzo', true), buildEntry('cena')];

    expect(getDefaultHomeMealType(entries, at(12))).toBe('desayuno');
    expect(getDefaultHomeMealType(entries, at(15))).toBe('cena');
  });

  it('falls back to the closest meal type when every one is cooked', () => {
    const entries = [
      buildEntry('desayuno', true),
      buildEntry('almuerzo', true),
      buildEntry('cena', true),
    ];

    expect(getDefaultHomeMealType(entries, at(14))).toBe('almuerzo');
    expect(getDefaultHomeMealType(entries, at(21))).toBe('cena');
  });

  it('returns null when there are no entries', () => {
    expect(getDefaultHomeMealType([], at(14))).toBeNull();
  });

  it('ignores snack entries', () => {
    expect(getDefaultHomeMealType([buildEntry('snack')], at(14))).toBeNull();
    expect(getDefaultHomeMealType([buildEntry('snack'), buildEntry('cena', true)], at(14))).toBe(
      'cena'
    );
  });
});

describe('meal confirmation', () => {
  const today = new Date(2026, 7, 25);
  const yesterdayKey = '2026-08-24';
  const todayKey = '2026-08-25';
  const tomorrowKey = '2026-08-26';

  function buildEntry(
    date: string,
    type: MealType,
    overrides: Partial<MealPlanEntry> = {}
  ): MealPlanEntry {
    return {
      id: `entry-${date}-${type}`,
      date,
      type,
      recipeId: `recipe-${type}`,
      isCooked: false,
      ...overrides,
    };
  }

  function isSelectable(dateKey: string, entries: MealPlanEntry[]) {
    return isSelectableMealDate(dateKey, buildLocalMealPlanByDate(entries), today, parseDateKey);
  }

  function isPending(dateKey: string, entries: MealPlanEntry[]) {
    return isPendingConfirmationDate(
      dateKey,
      buildLocalMealPlanByDate(entries),
      today,
      parseDateKey
    );
  }

  describe('isMealConfirmed', () => {
    it('treats a cooked or a skipped entry as confirmed', () => {
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'cena', { isCooked: true }))).toBe(true);
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'cena', { isSkipped: true }))).toBe(true);
    });

    it('treats an entry that is neither cooked nor skipped as unconfirmed', () => {
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'cena'))).toBe(false);
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'cena', { isSkipped: false }))).toBe(false);
    });
  });

  describe('getPendingConfirmationEntries', () => {
    it('returns the unconfirmed Home meals in meal order', () => {
      const entries = [
        buildEntry(yesterdayKey, 'cena'),
        buildEntry(yesterdayKey, 'snack'),
        buildEntry(yesterdayKey, 'almuerzo', { isCooked: true }),
        buildEntry(yesterdayKey, 'desayuno'),
      ];

      expect(getPendingConfirmationEntries(entries).map((entry) => entry.type)).toEqual([
        'desayuno',
        'cena',
      ]);
    });

    it('returns nothing when every Home meal is cooked or skipped', () => {
      const entries = [
        buildEntry(yesterdayKey, 'almuerzo', { isCooked: true }),
        buildEntry(yesterdayKey, 'cena', { isSkipped: true }),
      ];

      expect(getPendingConfirmationEntries(entries)).toEqual([]);
    });
  });

  describe('getPendingHomeMealType', () => {
    it('returns the first pending Home meal type', () => {
      const entries = [
        buildEntry(yesterdayKey, 'cena'),
        buildEntry(yesterdayKey, 'almuerzo'),
        buildEntry(yesterdayKey, 'desayuno', { isSkipped: true }),
      ];

      expect(getPendingHomeMealType(entries)).toBe('almuerzo');
    });

    it('returns null when nothing is pending', () => {
      expect(getPendingHomeMealType([])).toBeNull();
      expect(getPendingHomeMealType([buildEntry(yesterdayKey, 'snack')])).toBeNull();
      expect(getPendingHomeMealType([buildEntry(yesterdayKey, 'cena', { isCooked: true })])).toBe(
        null
      );
    });
  });

  describe('isPendingConfirmationDate', () => {
    it('is true for a past day with an unconfirmed meal', () => {
      expect(isPending(yesterdayKey, [buildEntry(yesterdayKey, 'cena')])).toBe(true);
    });

    it('is false for a past day whose meals are all confirmed', () => {
      const entries = [
        buildEntry(yesterdayKey, 'almuerzo', { isCooked: true }),
        buildEntry(yesterdayKey, 'cena', { isSkipped: true }),
      ];

      expect(isPending(yesterdayKey, entries)).toBe(false);
    });

    it('is false for a past day that only has a snack', () => {
      expect(isPending(yesterdayKey, [buildEntry(yesterdayKey, 'snack')])).toBe(false);
    });

    it('is false for a past day without a plan', () => {
      expect(isPending(yesterdayKey, [])).toBe(false);
    });

    it('is false for today and for a future day, even with unconfirmed meals', () => {
      expect(isPending(todayKey, [buildEntry(todayKey, 'cena')])).toBe(false);
      expect(isPending(tomorrowKey, [buildEntry(tomorrowKey, 'cena')])).toBe(false);
    });
  });

  describe('isSelectableMealDate', () => {
    it('makes a past day with an unconfirmed meal selectable', () => {
      expect(isSelectable(yesterdayKey, [buildEntry(yesterdayKey, 'cena')])).toBe(true);
    });

    it('keeps a past day not selectable when every meal is cooked', () => {
      const entries = [
        buildEntry(yesterdayKey, 'almuerzo', { isCooked: true }),
        buildEntry(yesterdayKey, 'cena', { isCooked: true }),
      ];

      expect(isSelectable(yesterdayKey, entries)).toBe(false);
    });

    it('keeps a past day not selectable when every meal is skipped', () => {
      const entries = [
        buildEntry(yesterdayKey, 'almuerzo', { isSkipped: true }),
        buildEntry(yesterdayKey, 'cena', { isSkipped: true }),
      ];

      expect(isSelectable(yesterdayKey, entries)).toBe(false);
    });

    it('makes a past day with one cooked and one unconfirmed meal selectable', () => {
      const entries = [
        buildEntry(yesterdayKey, 'almuerzo', { isCooked: true }),
        buildEntry(yesterdayKey, 'cena'),
      ];

      expect(isSelectable(yesterdayKey, entries)).toBe(true);
    });

    it('keeps a past day without a plan not selectable', () => {
      expect(isSelectable(yesterdayKey, [buildEntry(todayKey, 'cena')])).toBe(false);
    });

    it('keeps a past day that only has a snack not selectable', () => {
      expect(isSelectable(yesterdayKey, [buildEntry(yesterdayKey, 'snack')])).toBe(false);
    });

    it('keeps today and a future day selectable whenever they have a plan', () => {
      const entries = [
        buildEntry(todayKey, 'cena', { isCooked: true }),
        buildEntry(tomorrowKey, 'almuerzo'),
      ];

      expect(isSelectable(todayKey, entries)).toBe(true);
      expect(isSelectable(tomorrowKey, entries)).toBe(true);
    });

    it('keeps today and a future day not selectable without a plan', () => {
      expect(isSelectable(todayKey, [])).toBe(false);
      expect(isSelectable(tomorrowKey, [])).toBe(false);
    });
  });
});
