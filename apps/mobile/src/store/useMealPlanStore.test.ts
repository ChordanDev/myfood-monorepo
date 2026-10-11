import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MealPlanEntry } from '@/types/domain';
import { useInventoryStore } from '@/features/inventory/store';
import { buildInventoryItem } from '@/features/inventory/mocks';
import { loadLivePlan } from '@/features/home/hooks/useLoadLivePlan';
import { useMealPlanStore } from './useMealPlanStore';

const mockGetCalendar = jest.fn();
jest.mock('@/features/home/api/calendarApi', () => ({
  getCalendar: (...args: unknown[]) => mockGetCalendar(...args),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('marking a meal as cooked (the server consumes the stock)', () => {
  const entry: MealPlanEntry = {
    id: 'entry-1',
    date: '2026-08-25',
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
  };
  const rice = buildInventoryItem({
    id: 'inv-i1',
    ingredientId: 'i1',
    name: 'Rice',
    quantityMilli: 500_000,
    unit: 'g',
  });
  const oil = buildInventoryItem({
    id: 'inv-i5',
    ingredientId: 'i5',
    name: 'Olive oil',
    quantityMilli: 4_000,
    unit: 'ml',
  });

  beforeEach(() => {
    useMealPlanStore.setState({ entries: [entry] });
    useInventoryStore.setState({ items: [rice, oil] });
  });

  it('marks the entry as cooked without touching the local inventory', () => {
    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
    expect(useInventoryStore.getState().items).toEqual([rice, oil]);
  });

  it('keeps the entry cooked when it is marked twice', () => {
    useMealPlanStore.getState().markAsCooked('entry-1');
    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
    expect(useInventoryStore.getState().items).toEqual([rice, oil]);
  });
});

describe('meal confirmation', () => {
  const rice = buildInventoryItem({
    id: 'inv-rice',
    ingredientId: 'rice',
    name: 'Rice',
    quantityMilli: 500_000,
    unit: 'g',
  });
  const initialInventory = [rice];

  function seedEntry(overrides: Partial<MealPlanEntry> = {}) {
    const entry: MealPlanEntry = {
      id: 'entry-1',
      date: '2026-08-24',
      type: 'dinner',
      recipeId: 'recipe-1',
      isCooked: false,
      ...overrides,
    };

    useMealPlanStore.setState({ entries: [entry] });
  }

  function getEntry() {
    return useMealPlanStore.getState().entries[0];
  }

  function getInventory() {
    return useInventoryStore.getState().items;
  }

  beforeEach(() => {
    useInventoryStore.setState({ items: initialInventory });
  });

  it('marks an entry as cooked and leaves the inventory untouched', () => {
    seedEntry();

    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(getEntry().isCooked).toBe(true);
    expect(getInventory()).toEqual(initialInventory);
  });

  it('marks an entry as skipped and leaves the inventory untouched', () => {
    seedEntry();

    useMealPlanStore.getState().markAsSkipped('entry-1');

    expect(getEntry()).toMatchObject({ isSkipped: true, isCooked: false });
    expect(getInventory()).toEqual(initialInventory);
  });

  it('does not skip an entry that is already cooked', () => {
    seedEntry({ isCooked: true });

    useMealPlanStore.getState().markAsSkipped('entry-1');

    expect(getEntry().isSkipped).toBeUndefined();
    expect(getEntry().isCooked).toBe(true);
  });

  it('ignores a skip for an entry that does not exist', () => {
    seedEntry();
    const entriesBefore = useMealPlanStore.getState().entries;

    useMealPlanStore.getState().markAsSkipped('missing-entry');

    expect(useMealPlanStore.getState().entries).toBe(entriesBefore);
  });

  it('does not cook an entry that was skipped, and leaves the inventory untouched', () => {
    seedEntry({ isSkipped: true });

    useMealPlanStore.getState().markAsCooked('entry-1');

    expect(getEntry()).toMatchObject({ isSkipped: true, isCooked: false });
    expect(getInventory()).toEqual(initialInventory);
  });
});

describe('the plan cache', () => {
  const STORAGE_KEY = 'meal-plan-storage';
  const storedEntry: MealPlanEntry = {
    id: 'stored-1',
    date: '2026-08-25',
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
  };

  afterEach(async () => {
    jest.restoreAllMocks();
    await AsyncStorage.clear();
  });

  it('starts empty: no fixture plan or recipes are seeded', () => {
    const initial = useMealPlanStore.getInitialState();

    expect(initial.entries).toEqual([]);
    expect(initial.recipes).toEqual([]);
    expect(initial.recipeSummaries).toEqual({});
  });

  it('is filled by the calendar read', async () => {
    mockGetCalendar.mockResolvedValue({
      startDate: '2026-09-07',
      endDate: '2027-01-06',
      today: '2026-10-08',
      meals: [
        {
          mealId: 'meal-1',
          date: '2026-10-09',
          slot: 'dinner',
          recipeId: 'recipe-9',
          recipeName: 'Lentil stew',
          isFavorite: false,
          isCooked: false,
          selectedQuantity: null,
          prepTimeMinutes: 25,
          macros: { calories: 480 },
        },
      ],
    });
    useMealPlanStore.setState({ entries: [], recipeSummaries: {} });

    await loadLivePlan(new Date(2026, 9, 8));

    expect(mockGetCalendar).toHaveBeenCalledWith({
      startDate: '2026-09-07',
      endDate: '2027-01-06',
    });
    expect(useMealPlanStore.getState().entries).toEqual([
      expect.objectContaining({
        id: 'meal-1',
        date: '2026-10-09',
        type: 'dinner',
        recipeId: 'recipe-9',
      }),
    ]);
    expect(useMealPlanStore.getState().recipeSummaries['recipe-9']?.name).toBe('Lentil stew');
  });

  it('keeps the cached plan when the calendar read fails', async () => {
    mockGetCalendar.mockRejectedValue(new Error('offline'));
    useMealPlanStore.setState({ entries: [storedEntry] });

    await expect(loadLivePlan()).rejects.toThrow('offline');

    expect(useMealPlanStore.getState().entries).toEqual([storedEntry]);
  });

  it('comes back from the device when it was stored with the current version', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 3, state: { entries: [storedEntry] } })
    );

    await useMealPlanStore.persist.rehydrate();

    expect(useMealPlanStore.getState().entries).toEqual([storedEntry]);
  });

  it('starts the plan empty and keeps the rest of the stored state when it was stored before version 3', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: { entries: [storedEntry], customKey: 'kept' },
      })
    );

    await useMealPlanStore.persist.rehydrate();

    expect(useMealPlanStore.getState().entries).toEqual([]);
    expect(useMealPlanStore.getState()).toMatchObject({ customKey: 'kept' });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
