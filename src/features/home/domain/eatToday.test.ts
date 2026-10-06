import type { MealPlanEntry, MealType } from '@/types/domain';
import {
  EAT_TODAY_CUTOFF_MINUTES,
  EAT_TODAY_DESTINATION_TYPES,
  EAT_TODAY_LABEL,
  getAvailableEatTodayDestinations,
} from './eatToday';

const TODAY_KEY = '2026-08-25';

function buildEntry(type: MealType, isCooked = false): MealPlanEntry {
  return { id: `entry-${type}`, date: TODAY_KEY, type, recipeId: `recipe-${type}`, isCooked };
}

function at(hours: number, minutes = 0) {
  return new Date(2026, 7, 25, hours, minutes);
}

describe('eat today constants', () => {
  it('offers lunch and dinner as destinations, in that order', () => {
    expect(EAT_TODAY_DESTINATION_TYPES).toEqual(['almuerzo', 'cena']);
  });

  it('closes lunch at 15:00 and dinner at 22:00', () => {
    expect(EAT_TODAY_CUTOFF_MINUTES).toEqual({ almuerzo: 15 * 60, cena: 22 * 60 });
  });

  it('labels each destination', () => {
    expect(EAT_TODAY_LABEL).toEqual({ almuerzo: 'Mediodía', cena: 'Cena' });
  });
});

describe('getAvailableEatTodayDestinations', () => {
  const uncookedDay = [buildEntry('almuerzo'), buildEntry('cena')];

  it('returns both destinations before any cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(10))).toEqual(['almuerzo', 'cena']);
  });

  it('returns only dinner after the lunch cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(15, 1))).toEqual(['cena']);
  });

  it('returns nothing after the dinner cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(22, 30))).toEqual([]);
  });

  it('keeps a destination open until the last minute before its cutoff', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(14, 59))).toEqual(['almuerzo', 'cena']);
    expect(getAvailableEatTodayDestinations(uncookedDay, at(21, 59))).toEqual(['cena']);
  });

  it('closes a destination exactly at its cutoff minute', () => {
    expect(getAvailableEatTodayDestinations(uncookedDay, at(15))).toEqual(['cena']);
    expect(getAvailableEatTodayDestinations(uncookedDay, at(22))).toEqual([]);
  });

  it('excludes lunch when it is already cooked today', () => {
    const entries = [buildEntry('almuerzo', true), buildEntry('cena')];

    expect(getAvailableEatTodayDestinations(entries, at(10))).toEqual(['cena']);
  });

  it('excludes dinner when it is already cooked today', () => {
    const entries = [buildEntry('almuerzo'), buildEntry('cena', true)];

    expect(getAvailableEatTodayDestinations(entries, at(10))).toEqual(['almuerzo']);
  });

  it('ignores cooked entries of other meal types', () => {
    const entries = [buildEntry('desayuno', true), buildEntry('snack', true)];

    expect(getAvailableEatTodayDestinations(entries, at(10))).toEqual(['almuerzo', 'cena']);
  });

  it('treats a day without entries as fully available before the cutoffs', () => {
    expect(getAvailableEatTodayDestinations([], at(10))).toEqual(['almuerzo', 'cena']);
    expect(getAvailableEatTodayDestinations([], at(23))).toEqual([]);
  });
});
