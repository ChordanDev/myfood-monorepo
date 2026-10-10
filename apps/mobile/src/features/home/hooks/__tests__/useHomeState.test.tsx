import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry, MealSlot } from '@/types/domain';
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

// Marking a meal as cooked in the store is only local: the server consumes the stock.
const recipes: MasterRecipe[] = [
  { ...MOCK_MASTER_RECIPES[0], id: 'recipe-salad', name: 'Ensalada de tomate', ingredients: [] },
  { ...MOCK_MASTER_RECIPES[0], id: 'recipe-soup', name: 'Sopa de pollo', ingredients: [] },
];

function buildEntry(
  date: string,
  type: MealSlot,
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
      buildEntry(TODAY, 'lunch'),
      buildEntry(TODAY, 'dinner', { recipeId: 'recipe-soup' }),
      buildEntry(YESTERDAY, 'breakfast', { isCooked: true }),
      buildEntry(YESTERDAY, 'lunch'),
      buildEntry(YESTERDAY, 'dinner', { recipeId: 'recipe-soup' }),
    ];

    it('opens on today instead of jumping to the pending day', () => {
      renderHomeState(entries);

      expect(hookResult.selectedDate).toBe(TODAY);
      expect(hookResult.isPendingConfirmationDay).toBe(false);
      expect(hookResult.availableMealTypes).toEqual(['lunch', 'dinner']);
      expect(hookResult.selectedMealType).toBe('dinner');
    });

    it('offers only the unconfirmed meals of the pending day, starting with the first one', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);

      expect(hookResult.selectedDate).toBe(YESTERDAY);
      expect(hookResult.isPendingConfirmationDay).toBe(true);
      expect(hookResult.availableMealTypes).toEqual(['lunch', 'dinner']);
      expect(hookResult.selectedMealType).toBe('lunch');
      expect(hookResult.selectedMeal?.id).toBe(`${YESTERDAY}-lunch`);
    });

    it('lists every Home meal of the pending day with its recipe name', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);

      expect(hookResult.selectedDayMeals).toEqual([
        { id: `${YESTERDAY}-breakfast`, type: 'breakfast', name: 'Ensalada de tomate' },
        { id: `${YESTERDAY}-lunch`, type: 'lunch', name: 'Ensalada de tomate' },
        { id: `${YESTERDAY}-dinner`, type: 'dinner', name: 'Sopa de pollo' },
      ]);
    });

    it('does not switch to a meal that is already confirmed', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);

      act(() => {
        hookResult.handleMealTypeChange('breakfast');
      });

      expect(hookResult.selectedMealType).toBe('lunch');
    });

    it('moves to the next pending meal after one of two is confirmed', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);
      confirm('markAsCooked', `${YESTERDAY}-lunch`);

      expect(hookResult.selectedDate).toBe(YESTERDAY);
      expect(hookResult.isPendingConfirmationDay).toBe(true);
      expect(hookResult.availableMealTypes).toEqual(['dinner']);
      expect(hookResult.selectedMealType).toBe('dinner');
      expect(hookResult.selectedMeal?.id).toBe(`${YESTERDAY}-dinner`);
    });

    it('returns to today once the last pending meal is confirmed', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);
      act(() => {
        hookResult.handleMealTypeChange('dinner');
      });
      confirm('markAsSkipped', `${YESTERDAY}-dinner`);
      confirm('markAsCooked', `${YESTERDAY}-lunch`);

      expect(hookResult.selectedDate).toBe(TODAY);
      expect(hookResult.isPendingConfirmationDay).toBe(false);
      expect(hookResult.availableMealTypes).toEqual(['lunch', 'dinner']);
      expect(hookResult.selectedMealType).toBe('dinner');
      expect(hookResult.selectedMeal?.id).toBe(`${TODAY}-dinner`);
    });
  });

  describe('without a plan for today', () => {
    const entries = [
      buildEntry(TWO_DAYS_AGO, 'dinner', { isCooked: true }),
      buildEntry(YESTERDAY, 'dinner'),
      buildEntry(TOMORROW, 'lunch'),
    ];

    it('does not open on a past day', () => {
      renderHomeState(entries);

      expect(hookResult.selectedDate).toBe(TOMORROW);
      expect(hookResult.isPendingConfirmationDay).toBe(false);
    });

    it('leaves the confirmed day for a selectable one, never for another past day', () => {
      renderHomeState(entries);
      selectDate(YESTERDAY);
      confirm('markAsCooked', `${YESTERDAY}-dinner`);

      expect(hookResult.selectedDate).toBe(TOMORROW);
      expect(hookResult.selectedMealType).toBe('lunch');
    });

    it('stays on today when nothing is planned from today on', () => {
      renderHomeState([buildEntry(YESTERDAY, 'dinner')]);

      expect(hookResult.selectedDate).toBe(TODAY);

      selectDate(YESTERDAY);
      confirm('markAsSkipped', `${YESTERDAY}-dinner`);

      expect(hookResult.selectedDate).toBe(TODAY);
      expect(hookResult.selectedMealType).toBeNull();
    });
  });
});
