import type { MealPlanEntry, MealSlot, RecipeSummary } from '@/types/domain';
import {
  buildLocalMealPlanByDate,
  getDefaultHomeMealType,
  getHomeMealSummaries,
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

  it('ships yesterday as a pending day and the day before as an already confirmed one', () => {
    let mockMealPlan: typeof import('@/mocks/domainMocks').MOCK_MEAL_PLAN;

    jest.isolateModules(() => {
      ({ MOCK_MEAL_PLAN: mockMealPlan } = jest.requireActual('@/mocks/domainMocks'));
    });

    const today = startOfDay(new Date());
    const planByDate = buildLocalMealPlanByDate(mockMealPlan!);

    expect(planByDate['2026-08-24'].map((entry) => entry.type)).toEqual(['lunch', 'dinner']);
    expect(isPendingConfirmationDate('2026-08-24', planByDate, today, parseDateKey)).toBe(true);
    expect(planByDate['2026-08-23']).toHaveLength(2);
    expect(isPendingConfirmationDate('2026-08-23', planByDate, today, parseDateKey)).toBe(false);
    expect(isSelectableMealDate('2026-08-23', planByDate, today, parseDateKey)).toBe(false);
  });
});

describe('getDefaultHomeMealType', () => {
  function buildEntry(type: MealSlot, isCooked = false): MealPlanEntry {
    return { id: `entry-${type}`, date: '2026-08-25', type, recipeId: `recipe-${type}`, isCooked };
  }

  function at(hours: number, minutes = 0) {
    return new Date(2026, 7, 25, hours, minutes);
  }

  it('picks the closest meal type when none is cooked', () => {
    const entries = [buildEntry('breakfast'), buildEntry('lunch'), buildEntry('dinner')];

    expect(getDefaultHomeMealType(entries, at(7))).toBe('breakfast');
    expect(getDefaultHomeMealType(entries, at(14))).toBe('lunch');
    expect(getDefaultHomeMealType(entries, at(19))).toBe('dinner');
  });

  it('skips a cooked lunch at 14:00 and picks dinner', () => {
    const entries = [
      buildEntry('breakfast', true),
      buildEntry('lunch', true),
      buildEntry('dinner'),
    ];

    expect(getDefaultHomeMealType(entries, at(14))).toBe('dinner');
  });

  it('picks the closest uncooked meal type even when a cooked one is nearer', () => {
    const entries = [buildEntry('breakfast'), buildEntry('lunch', true), buildEntry('dinner')];

    expect(getDefaultHomeMealType(entries, at(12))).toBe('breakfast');
    expect(getDefaultHomeMealType(entries, at(15))).toBe('dinner');
  });

  it('falls back to the closest meal type when every one is cooked', () => {
    const entries = [
      buildEntry('breakfast', true),
      buildEntry('lunch', true),
      buildEntry('dinner', true),
    ];

    expect(getDefaultHomeMealType(entries, at(14))).toBe('lunch');
    expect(getDefaultHomeMealType(entries, at(21))).toBe('dinner');
  });

  it('returns null when there are no entries', () => {
    expect(getDefaultHomeMealType([], at(14))).toBeNull();
  });

  it('ignores snack entries', () => {
    expect(getDefaultHomeMealType([buildEntry('snack')], at(14))).toBeNull();
    expect(getDefaultHomeMealType([buildEntry('snack'), buildEntry('dinner', true)], at(14))).toBe(
      'dinner'
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
    type: MealSlot,
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
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'dinner', { isCooked: true }))).toBe(true);
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'dinner', { isSkipped: true }))).toBe(true);
    });

    it('treats an entry that is neither cooked nor skipped as unconfirmed', () => {
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'dinner'))).toBe(false);
      expect(isMealConfirmed(buildEntry(yesterdayKey, 'dinner', { isSkipped: false }))).toBe(false);
    });
  });

  describe('getPendingConfirmationEntries', () => {
    it('returns the unconfirmed Home meals in meal order', () => {
      const entries = [
        buildEntry(yesterdayKey, 'dinner'),
        buildEntry(yesterdayKey, 'snack'),
        buildEntry(yesterdayKey, 'lunch', { isCooked: true }),
        buildEntry(yesterdayKey, 'breakfast'),
      ];

      expect(getPendingConfirmationEntries(entries).map((entry) => entry.type)).toEqual([
        'breakfast',
        'dinner',
      ]);
    });

    it('returns nothing when every Home meal is cooked or skipped', () => {
      const entries = [
        buildEntry(yesterdayKey, 'lunch', { isCooked: true }),
        buildEntry(yesterdayKey, 'dinner', { isSkipped: true }),
      ];

      expect(getPendingConfirmationEntries(entries)).toEqual([]);
    });
  });

  describe('getPendingHomeMealType', () => {
    it('returns the first pending Home meal type', () => {
      const entries = [
        buildEntry(yesterdayKey, 'dinner'),
        buildEntry(yesterdayKey, 'lunch'),
        buildEntry(yesterdayKey, 'breakfast', { isSkipped: true }),
      ];

      expect(getPendingHomeMealType(entries)).toBe('lunch');
    });

    it('returns null when nothing is pending', () => {
      expect(getPendingHomeMealType([])).toBeNull();
      expect(getPendingHomeMealType([buildEntry(yesterdayKey, 'snack')])).toBeNull();
      expect(getPendingHomeMealType([buildEntry(yesterdayKey, 'dinner', { isCooked: true })])).toBe(
        null
      );
    });
  });

  describe('isPendingConfirmationDate', () => {
    it('is true for a past day with an unconfirmed meal', () => {
      expect(isPending(yesterdayKey, [buildEntry(yesterdayKey, 'dinner')])).toBe(true);
    });

    it('is false for a past day whose meals are all confirmed', () => {
      const entries = [
        buildEntry(yesterdayKey, 'lunch', { isCooked: true }),
        buildEntry(yesterdayKey, 'dinner', { isSkipped: true }),
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
      expect(isPending(todayKey, [buildEntry(todayKey, 'dinner')])).toBe(false);
      expect(isPending(tomorrowKey, [buildEntry(tomorrowKey, 'dinner')])).toBe(false);
    });
  });

  describe('isSelectableMealDate', () => {
    it('makes a past day with an unconfirmed meal selectable', () => {
      expect(isSelectable(yesterdayKey, [buildEntry(yesterdayKey, 'dinner')])).toBe(true);
    });

    it('keeps a past day not selectable when every meal is cooked', () => {
      const entries = [
        buildEntry(yesterdayKey, 'lunch', { isCooked: true }),
        buildEntry(yesterdayKey, 'dinner', { isCooked: true }),
      ];

      expect(isSelectable(yesterdayKey, entries)).toBe(false);
    });

    it('keeps a past day not selectable when every meal is skipped', () => {
      const entries = [
        buildEntry(yesterdayKey, 'lunch', { isSkipped: true }),
        buildEntry(yesterdayKey, 'dinner', { isSkipped: true }),
      ];

      expect(isSelectable(yesterdayKey, entries)).toBe(false);
    });

    it('makes a past day with one cooked and one unconfirmed meal selectable', () => {
      const entries = [
        buildEntry(yesterdayKey, 'lunch', { isCooked: true }),
        buildEntry(yesterdayKey, 'dinner'),
      ];

      expect(isSelectable(yesterdayKey, entries)).toBe(true);
    });

    it('keeps a past day without a plan not selectable', () => {
      expect(isSelectable(yesterdayKey, [buildEntry(todayKey, 'dinner')])).toBe(false);
    });

    it('keeps a past day that only has a snack not selectable', () => {
      expect(isSelectable(yesterdayKey, [buildEntry(yesterdayKey, 'snack')])).toBe(false);
    });

    it('keeps today and a future day selectable whenever they have a plan', () => {
      const entries = [
        buildEntry(todayKey, 'dinner', { isCooked: true }),
        buildEntry(tomorrowKey, 'lunch'),
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

describe('getHomeMealSummaries', () => {
  function buildEntry(type: MealSlot, recipeId: string): MealPlanEntry {
    return { id: `entry-${type}`, date: '2026-08-24', type, recipeId, isCooked: false };
  }

  function buildSummary(name: string): RecipeSummary {
    return { name, isFavorite: false, prepTimeMinutes: null, calories: null };
  }

  const summaries = {
    'recipe-soup': buildSummary('Sopa de pollo'),
    'recipe-salad': buildSummary('Ensalada de tomate'),
  };

  it('names the Home meals of a day in meal order', () => {
    const entries = [
      buildEntry('dinner', 'recipe-soup'),
      buildEntry('snack', 'recipe-salad'),
      buildEntry('lunch', 'recipe-salad'),
    ];

    expect(getHomeMealSummaries(entries, summaries)).toEqual([
      { id: 'entry-lunch', type: 'lunch', name: 'Ensalada de tomate' },
      { id: 'entry-dinner', type: 'dinner', name: 'Sopa de pollo' },
    ]);
  });

  it('uses a placeholder name when the recipe is unknown', () => {
    expect(getHomeMealSummaries([buildEntry('dinner', 'recipe-missing')], summaries)).toEqual([
      { id: 'entry-dinner', type: 'dinner', name: 'Receta sin nombre' },
    ]);
  });
});
