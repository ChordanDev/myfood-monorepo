import type { MealPlanEntry, MealSlot } from '@/types/domain';
import {
  EAT_TODAY_CUTOFF_MINUTES,
  EAT_TODAY_DESTINATION_TYPES,
  EAT_TODAY_LABEL,
  getAvailableEatTodayDestinations,
  planEatTodayReplacement,
} from './eatToday';

const TODAY_KEY = '2026-08-25';

function buildEntry(type: MealSlot, isCooked = false): MealPlanEntry {
  return { id: `entry-${type}`, date: TODAY_KEY, type, recipeId: `recipe-${type}`, isCooked };
}

function at(hours: number, minutes = 0) {
  return new Date(2026, 7, 25, hours, minutes);
}

describe('eat today constants', () => {
  it('offers lunch and dinner as destinations, in that order', () => {
    expect(EAT_TODAY_DESTINATION_TYPES).toEqual(['lunch', 'dinner']);
  });

  it('closes lunch at 15:00 and dinner at 22:00', () => {
    expect(EAT_TODAY_CUTOFF_MINUTES).toEqual({ lunch: 15 * 60, dinner: 22 * 60 });
  });

  it('labels each destination', () => {
    expect(EAT_TODAY_LABEL).toEqual({ lunch: 'Mediodía', dinner: 'Cena' });
  });
});

describe('getAvailableEatTodayDestinations', () => {
  const uncookedDay = [buildEntry('lunch'), buildEntry('dinner')];

  it('returns both destinations before any cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(10))).toEqual(['lunch', 'dinner']);
  });

  it('returns only dinner after the lunch cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(15, 1))).toEqual(['dinner']);
  });

  it('returns nothing after the dinner cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(22, 30))).toEqual([]);
  });

  it('keeps a destination open until the last minute before its cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(14, 59))).toEqual(['lunch', 'dinner']);
    expect(getAvailableEatTodayDestinations(uncookedDay, at(21, 59))).toEqual(['dinner']);
  });

  it('closes a destination exactly at its cutoff minute', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(15))).toEqual(['dinner']);
    expect(getAvailableEatTodayDestinations(uncookedDay, at(22))).toEqual([]);
  });

  it('excludes lunch when it is already cooked today', () => {
    const entries = [buildEntry('lunch', true), buildEntry('dinner')];

    expect(getAvailableEatTodayDestinations(entries, at(10))).toEqual(['dinner']);
  });

  it('excludes dinner when it is already cooked today', () => {
    const entries = [buildEntry('lunch'), buildEntry('dinner', true)];

    expect(getAvailableEatTodayDestinations(entries, at(10))).toEqual(['lunch']);
  });

  it('ignores cooked entries of other meal types', () => {
    const entries = [buildEntry('breakfast', true), buildEntry('snack', true)];

    expect(getAvailableEatTodayDestinations(entries, at(10))).toEqual(['lunch', 'dinner']);
  });

  it('treats a day without entries as fully available before the cutoffs', () => {
    expect(getAvailableEatTodayDestinations([], at(10))).toEqual(['lunch', 'dinner']);
    expect(getAvailableEatTodayDestinations([], at(23))).toEqual([]);
  });
});

describe('planEatTodayReplacement', () => {
  function entry(
    id: string,
    date: string,
    type: MealSlot,
    overrides: Partial<MealPlanEntry> = {}
  ): MealPlanEntry {
    return { id, date, type, recipeId: `recipe-${id}`, isCooked: false, ...overrides };
  }

  const params = {
    sourceDate: '2026-08-27',
    sourceType: 'dinner' as const,
    targetDate: TODAY_KEY,
    targetType: 'lunch' as const,
  };

  it('swaps the source with the meal of the destination and sends every meal of the range', () => {
    const entries = [
      entry('today-lunch', TODAY_KEY, 'lunch', { selectedQuantity: 2 }),
      entry('other-day', '2026-08-26', 'lunch'),
      entry('source', '2026-08-27', 'dinner'),
      entry('outside', '2026-09-30', 'lunch'),
    ];

    expect(planEatTodayReplacement(entries, params)).toEqual({
      from: TODAY_KEY,
      to: '2026-08-27',
      meals: [
        {
          date: '2026-08-27',
          slot: 'dinner',
          recipeId: 'recipe-today-lunch',
          isCooked: false,
          selectedQuantity: 2,
        },
        { date: '2026-08-26', slot: 'lunch', recipeId: 'recipe-other-day', isCooked: false },
        { date: TODAY_KEY, slot: 'lunch', recipeId: 'recipe-source', isCooked: false },
      ],
    });
  });

  it('moves the source when the destination is empty, leaving the rest of the range as it is', () => {
    const entries = [
      entry('source', '2026-08-27', 'dinner'),
      entry('other-day', '2026-08-26', 'lunch'),
    ];

    const replacement = planEatTodayReplacement(entries, params);

    expect(replacement?.meals).toEqual([
      { date: TODAY_KEY, slot: 'lunch', recipeId: 'recipe-source', isCooked: false },
      { date: '2026-08-26', slot: 'lunch', recipeId: 'recipe-other-day', isCooked: false },
    ]);
  });

  it('works on a one-day range when both meals are on the same day', () => {
    const entries = [entry('a', TODAY_KEY, 'dinner'), entry('b', TODAY_KEY, 'lunch')];

    const replacement = planEatTodayReplacement(entries, { ...params, sourceDate: TODAY_KEY });

    expect(replacement).toMatchObject({ from: TODAY_KEY, to: TODAY_KEY });
    expect(replacement?.meals).toHaveLength(2);
  });

  it('plans nothing when the source is missing or cooked', () => {
    expect(planEatTodayReplacement([], params)).toBeNull();
    expect(
      planEatTodayReplacement([entry('source', '2026-08-27', 'dinner', { isCooked: true })], params)
    ).toBeNull();
  });

  it('plans nothing when the destination meal is already cooked', () => {
    const entries = [
      entry('source', '2026-08-27', 'dinner'),
      entry('today-lunch', TODAY_KEY, 'lunch', { isCooked: true }),
    ];

    expect(planEatTodayReplacement(entries, params)).toBeNull();
  });
});
