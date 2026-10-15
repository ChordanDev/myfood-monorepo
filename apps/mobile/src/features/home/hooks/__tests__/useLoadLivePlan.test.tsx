import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { getRecipe } from '@/features/recipe/api/recipeApi';
import { fixtureRecipe } from '@/features/recipe/fixtures/recipeDetail';
import { useRecipeCacheStore } from '@/features/recipe/store';
import { useMealPlanStore } from '@/store';
import { formatDateKey } from '../../utils/calendarDate';
import { useLoadLivePlan } from '../useLoadLivePlan';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockGetCalendar = jest.fn();
jest.mock('../../api/calendarApi', () => ({
  getCalendar: (...args: unknown[]) => mockGetCalendar(...args),
}));

jest.mock('@/features/recipe/api/recipeApi', () => ({ getRecipe: jest.fn() }));

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = formatDateKey(new Date());
const TOMORROW = formatDateKey(new Date(Date.now() + 2 * DAY_MS));

const getRecipeMock = jest.mocked(getRecipe);

function calendarMeal(mealId: string, date: string, slot: string, recipeId: string | null) {
  return {
    mealId,
    date,
    slot,
    recipeId,
    recipeName: 'Lentil stew',
    isFavorite: false,
    isCooked: false,
    selectedQuantity: null,
    prepTimeMinutes: 25,
    macros: { calories: 480 },
  };
}

let tree: ReactTestRenderer | undefined;

// The react-native preset mocks AppState; the hook's listener is the last one registered.
function comeToForeground() {
  const [, listener] = jest.mocked(AppState.addEventListener).mock.calls.at(-1)!;
  (listener as (state: AppStateStatus) => void)('active');
}

function fetchedRecipeIds() {
  return getRecipeMock.mock.calls.map(([recipeId]) => recipeId).sort();
}

function Harness() {
  useLoadLivePlan();
  return null;
}

beforeEach(() => {
  mockGetCalendar.mockReset();
  useMealPlanStore.setState({ entries: [], recipeSummaries: {} });
  useRecipeCacheStore.getState().clear();
  getRecipeMock.mockReset();
  getRecipeMock.mockImplementation(async (recipeId: string) => ({
    ...fixtureRecipe(),
    id: recipeId,
    recipeVersionId: `v-${recipeId}`,
  }));
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

describe('useLoadLivePlan', () => {
  it("prefetches the Recipes of today's meals into the cache after the calendar read", async () => {
    mockGetCalendar.mockResolvedValue({
      meals: [
        calendarMeal('m1', TODAY, 'lunch', 'r-lunch'),
        calendarMeal('m2', TODAY, 'dinner', 'r-dinner'),
        calendarMeal('m3', TOMORROW, 'lunch', 'r-tomorrow'),
      ],
    });

    await act(async () => {
      tree = create(<Harness />);
    });

    expect(fetchedRecipeIds()).toEqual(['r-dinner', 'r-lunch']);
    const cache = useRecipeCacheStore.getState();
    expect(cache.getCachedRecipe('r-lunch')?.id).toBe('r-lunch');
    expect(cache.getCachedRecipe('r-dinner')?.id).toBe('r-dinner');
    expect(cache.getCachedRecipe('r-tomorrow')).toBeUndefined();
  });

  it('fetches nothing when the calendar read fails', async () => {
    mockGetCalendar.mockRejectedValue(new Error('offline'));

    await act(async () => {
      tree = create(<Harness />);
    });

    expect(getRecipeMock).not.toHaveBeenCalled();
  });

  it('still caches the other Recipes when one of them fails to load', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    getRecipeMock.mockImplementation(async (recipeId: string) => {
      if (recipeId === 'r-lunch') throw new Error('offline');
      return { ...fixtureRecipe(), id: recipeId, recipeVersionId: `v-${recipeId}` };
    });
    mockGetCalendar.mockResolvedValue({
      meals: [
        calendarMeal('m1', TODAY, 'lunch', 'r-lunch'),
        calendarMeal('m2', TODAY, 'dinner', 'r-dinner'),
      ],
    });

    await act(async () => {
      tree = create(<Harness />);
    });
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);

    expect(fetchedRecipeIds()).toEqual(['r-dinner', 'r-lunch']);
    const cache = useRecipeCacheStore.getState();
    expect(cache.getCachedRecipe('r-lunch')).toBeUndefined();
    expect(cache.getCachedRecipe('r-dinner')?.id).toBe('r-dinner');
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("prefetches today's Recipes again when the app comes back to the foreground", async () => {
    mockGetCalendar.mockResolvedValueOnce({
      meals: [calendarMeal('m1', TODAY, 'lunch', 'r-lunch')],
    });
    // The plan changed while the app was in the background.
    mockGetCalendar.mockResolvedValueOnce({
      meals: [
        calendarMeal('m1', TODAY, 'lunch', 'r-lunch'),
        calendarMeal('m2', TODAY, 'dinner', 'r-dinner'),
      ],
    });

    await act(async () => {
      tree = create(<Harness />);
    });
    expect(fetchedRecipeIds()).toEqual(['r-lunch']);

    await act(async () => {
      comeToForeground();
    });

    expect(mockGetCalendar).toHaveBeenCalledTimes(2);
    expect(fetchedRecipeIds()).toEqual(['r-dinner', 'r-lunch']);
    expect(useRecipeCacheStore.getState().getCachedRecipe('r-dinner')?.id).toBe('r-dinner');
  });

  it('does not fetch a Recipe the cache already holds', async () => {
    const cached = { ...fixtureRecipe(), id: 'r-lunch', recipeVersionId: 'v-r-lunch' };
    useRecipeCacheStore.setState({
      recipesByVersionId: { 'v-r-lunch': cached },
      versionIdByRecipeId: { 'r-lunch': 'v-r-lunch' },
    });
    mockGetCalendar.mockResolvedValue({
      meals: [
        calendarMeal('m1', TODAY, 'lunch', 'r-lunch'),
        calendarMeal('m2', TODAY, 'dinner', 'r-dinner'),
      ],
    });

    await act(async () => {
      tree = create(<Harness />);
    });

    expect(fetchedRecipeIds()).toEqual(['r-dinner']);
    expect(useRecipeCacheStore.getState().getCachedRecipe('r-lunch')).toBe(cached);
  });
});
