import type { MealPlanEntry, MealType } from '@/types/domain';
import {
  buildLocalMealPlanByDate,
  getDefaultHomeMealType,
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
