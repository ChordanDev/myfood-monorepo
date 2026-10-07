import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry, MealType } from '@/types/domain';
import { MOCK_MASTER_RECIPES } from '@/mocks/domainMocks';
import { useMealPlanStore } from '@/store';
import { useHomeState } from '../useHomeState';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const TWO_DAYS_AGO = '2026-08-23';
const YESTERDAY = '2026-08-24';
const TODAY = '2026-08-25';
const TOMORROW = '2026-08-26';

// No ingredients, so cooking a meal does not depend on the inventory store.
const recipes: MasterRecipe[] = [
  { ...MOCK_MASTER_RECIPES[0], id: 'recipe-salad', name: 'Ensalada de tomate', ingredients: [] },
  { ...MOCK_MASTER_RECIPES[0], id: 'recipe-soup', name: 'Sopa de pollo', ingredients: [] },
];

function buildEntry(
  date: string,
  type: MealType,
  overrides: Partial<MealPlanEntry> = {}
): MealPlanEntry {
  return {
    id: `${date}-${type}`,
    date,
    type,
    recipeId: 'recipe-salad',
    isCooked: false,
    ...overrides,
  };
}

let hookResult: ReturnType<typeof useHomeState>;
let tree: ReturnType<typeof create> | null = null;

function HookHarness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  hookResult = useHomeState();
  return null;
}

function renderHomeState(entries: MealPlanEntry[]) {
  useMealPlanStore.setState({ entries, recipes });

  act(() => {
    tree = create(<HookHarness />);
  });
}

function selectDate(dateString: string) {
  act(() => {
    hookResult.handleSelectDate(dateString);
  });
}

function confirm(action: 'markAsCooked' | 'markAsSkipped', entryId: string) {
  act(() => {
    useMealPlanStore.getState()[action](entryId);
  });
}

describe('useHomeState', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 20:30, so dinner is today's default meal and a pending day has to pick its own.
    jest.setSystemTime(new Date(2026, 7, 25, 20, 30));
  });

  afterEach(() => {
    act(() => {
      tree?.unmount();
    });
    tree = null;
    jest.useRealTimers();
  });

  describe('with a pending yesterday and a plan for today', () => {
    const entries = [
      buildEntry(TODAY, 'almuerzo'),
      buildEntry(TODAY, 'cena', { recipeId: 'recipe-soup' }),
      buildEntry(YESTERDAY, 'desayuno', { isCooked: true }),
      buildEntry(YESTERDAY, 'almuerzo'),
      buildEntry(YESTERDAY, 'cena', { recipeId: 'recipe-soup' }),
    ];

    it('opens on today instead of jumping to the pending day', () => {
      renderHomeState(entries);

      expect(hookResult.selectedDate).toBe(TODAY);
      expect(hookResult.isPendingConfirmationDay).toBe(false);
      expect(hookResult.availableMealTypes).toEqual(['almuerzo', 'cena']);
      expect(hookResult.selectedMealType).toBe('cena');
    });

    it('offers only the unconfirmed meals of the pending day, starting with the first one', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);

      expect(hookResult.selectedDate).toBe(YESTERDAY);
      expect(hookResult.isPendingConfirmationDay).toBe(true);
      expect(hookResult.availableMealTypes).toEqual(['almuerzo', 'cena']);
      expect(hookResult.selectedMealType).toBe('almuerzo');
      expect(hookResult.selectedMeal?.id).toBe(`${YESTERDAY}-almuerzo`);
    });

    it('lists every Home meal of the pending day with its recipe name', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);

      expect(hookResult.selectedDayMeals).toEqual([
        { id: `${YESTERDAY}-desayuno`, type: 'desayuno', name: 'Ensalada de tomate' },
        { id: `${YESTERDAY}-almuerzo`, type: 'almuerzo', name: 'Ensalada de tomate' },
        { id: `${YESTERDAY}-cena`, type: 'cena', name: 'Sopa de pollo' },
      ]);
    });

    it('does not switch to a meal that is already confirmed', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);

      act(() => {
        hookResult.handleMealTypeChange('desayuno');
      });

      expect(hookResult.selectedMealType).toBe('almuerzo');
    });

    it('moves to the next pending meal after one of two is confirmed', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);
      confirm('markAsCooked', `${YESTERDAY}-almuerzo`);

      expect(hookResult.selectedDate).toBe(YESTERDAY);
      expect(hookResult.isPendingConfirmationDay).toBe(true);
      expect(hookResult.availableMealTypes).toEqual(['cena']);
      expect(hookResult.selectedMealType).toBe('cena');
      expect(hookResult.selectedMeal?.id).toBe(`${YESTERDAY}-cena`);
    });

    it('returns to today once the last pending meal is confirmed', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);
      act(() => {
        hookResult.handleMealTypeChange('cena');
      });
      confirm('markAsSkipped', `${YESTERDAY}-cena`);
      confirm('markAsCooked', `${YESTERDAY}-almuerzo`);

      expect(hookResult.selectedDate).toBe(TODAY);
      expect(hookResult.isPendingConfirmationDay).toBe(false);
      expect(hookResult.availableMealTypes).toEqual(['almuerzo', 'cena']);
      expect(hookResult.selectedMealType).toBe('cena');
      expect(hookResult.selectedMeal?.id).toBe(`${TODAY}-cena`);
    });
  });

  describe('without a plan for today', () => {
    const entries = [
      buildEntry(TWO_DAYS_AGO, 'cena', { isCooked: true }),
      buildEntry(YESTERDAY, 'cena'),
      buildEntry(TOMORROW, 'almuerzo'),
    ];

    it('does not open on a past day', () => {
      renderHomeState(entries);

      expect(hookResult.selectedDate).toBe(TOMORROW);
      expect(hookResult.isPendingConfirmationDay).toBe(false);
    });

    it('leaves the confirmed day for a selectable one, never for another past day', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);
      confirm('markAsCooked', `${YESTERDAY}-cena`);

      expect(hookResult.selectedDate).toBe(TOMORROW);
      expect(hookResult.selectedMealType).toBe('almuerzo');
    });

    it('stays on today when nothing is planned from today on', () => {
      renderHomeState([buildEntry(YESTERDAY, 'cena')]);

      expect(hookResult.selectedDate).toBe(TODAY);

      selectDate(YESTERDAY);
      confirm('markAsSkipped', `${YESTERDAY}-cena`);

      expect(hookResult.selectedDate).toBe(TODAY);
      expect(hookResult.selectedMealType).toBeNull();
    });
  });
});
