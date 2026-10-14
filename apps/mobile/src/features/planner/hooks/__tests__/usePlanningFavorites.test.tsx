import React from 'react';
import { act, create } from 'react-test-renderer';
import { listFavorites } from '@/features/favorites/api/favoritesApi';
import { useFavoritesStore } from '@/features/favorites/store';
import type { FavoriteSummary } from '@/features/favorites';
import { usePlanningFavorites, type PlanningFavorites } from '../usePlanningFavorites';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The real barrel also loads the auth feature, which nothing here needs.
jest.mock('@/features/favorites', () => jest.requireActual('@/features/favorites/store'));

jest.mock('@/features/favorites/api/favoritesApi', () => ({ listFavorites: jest.fn() }));

const mockListFavorites = jest.mocked(listFavorites);

function favorite(recipeId: string, name: string): FavoriteSummary {
  return { recipeId, name, mainIngredients: [], durationMinutes: null };
}

const LENTEJAS = favorite('recipe-1', 'Lentejas');
const MILANESA = favorite('recipe-2', 'Milanesa');

let tree: ReturnType<typeof create>;
let planningFavorites: PlanningFavorites;

function Harness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  planningFavorites = usePlanningFavorites();
  return null;
}

async function mount(): Promise<void> {
  await act(async () => {
    tree = create(<Harness />);
  });
}

beforeEach(() => {
  useFavoritesStore.getState().clear();
  mockListFavorites.mockResolvedValue([LENTEJAS, MILANESA]);
});

afterEach(() => {
  act(() => tree.unmount());
});

describe('usePlanningFavorites', () => {
  it('reads the favorites from the server when the planner opens', async () => {
    await mount();

    expect(mockListFavorites).toHaveBeenCalledTimes(1);
    expect(planningFavorites.favorites).toEqual([LENTEJAS, MILANESA]);
  });

  it('keeps the cached favorites when the server cannot be reached', async () => {
    act(() => {
      useFavoritesStore.setState({ favorites: [LENTEJAS] });
    });
    mockListFavorites.mockRejectedValue(new Error('offline'));

    await mount();

    expect(planningFavorites.favorites).toEqual([LENTEJAS]);
  });

  it('selects nothing at first', async () => {
    await mount();

    expect(planningFavorites.selectedRecipeIds).toEqual([]);
  });

  it('selects a favorite and deselects it on the next toggle', async () => {
    await mount();

    act(() => planningFavorites.toggle('recipe-2'));
    expect(planningFavorites.selectedRecipeIds).toEqual(['recipe-2']);

    act(() => planningFavorites.toggle('recipe-2'));
    expect(planningFavorites.selectedRecipeIds).toEqual([]);
  });

  it('keeps the selected ids in the order they were picked', async () => {
    await mount();

    act(() => planningFavorites.toggle('recipe-2'));
    act(() => planningFavorites.toggle('recipe-1'));

    expect(planningFavorites.selectedRecipeIds).toEqual(['recipe-2', 'recipe-1']);
  });

  it('drops a favorite that left the store, and does not select it again when it comes back', async () => {
    await mount();
    act(() => planningFavorites.toggle('recipe-1'));
    act(() => planningFavorites.toggle('recipe-2'));

    act(() => {
      useFavoritesStore.setState({ favorites: [MILANESA] });
    });
    expect(planningFavorites.selectedRecipeIds).toEqual(['recipe-2']);

    act(() => {
      useFavoritesStore.setState({ favorites: [LENTEJAS, MILANESA] });
    });
    expect(planningFavorites.selectedRecipeIds).toEqual(['recipe-2']);
  });

  it('ignores a toggle of an id that is not a favorite', async () => {
    await mount();

    act(() => planningFavorites.toggle('recipe-unknown'));

    expect(planningFavorites.selectedRecipeIds).toEqual([]);
  });
});
