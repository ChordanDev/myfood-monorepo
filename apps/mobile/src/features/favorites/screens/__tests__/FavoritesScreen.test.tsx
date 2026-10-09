import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { addFavorite, listFavorites, removeFavorite } from '../../api/favoritesApi';
import { fixtureFavorites } from '../../fixtures/favorites';
import { useFavoritesStore } from '../../store';
import { FavoritesScreen } from '../FavoritesScreen';

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      alert: '#aa0000',
      appBg: '#ffffff',
      colorDark: '#111111',
      colorLight: '#eeeeee',
      primaryAccent: '#ff6600',
      textBlack: '#111112',
      textDark: '#111113',
      textLight: '#fafafa',
    },
  }),
}));

jest.mock('../../api/favoritesApi', () => ({
  listFavorites: jest.fn(),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
}));

const listMock = jest.mocked(listFavorites);
const addMock = jest.mocked(addFavorite);
const removeMock = jest.mocked(removeFavorite);

const [TORTILLA, LENTEJAS] = fixtureFavorites();

let tree: ReactTestRenderer | null = null;

async function renderScreen() {
  await act(async () => {
    tree = create(<FavoritesScreen />);
  });

  return tree!;
}

function has(testID: string) {
  return tree!.root.findAllByProps({ testID }).length > 0;
}

async function press(testID: string) {
  await act(async () => {
    tree!.root.findByProps({ testID, accessibilityRole: 'button' }).props.onPress();
  });
}

function texts() {
  return tree!.root.findAllByType(Text).map((node) => String(node.props.children));
}

beforeEach(() => {
  jest.clearAllMocks();
  useFavoritesStore.getState().clear();
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = null;
});

describe('FavoritesScreen', () => {
  it('reads the favorites from the server and draws title, main ingredients and duration', async () => {
    listMock.mockResolvedValue(fixtureFavorites());

    await renderScreen();

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual(
      expect.arrayContaining([
        'Tortilla de papas',
        'Papa, Aceite de girasol, Huevo',
        '40 min',
        'Ensalada de lentejas',
        'Lentejas',
      ])
    );
  });

  it('draws no duration for a recipe that states none', async () => {
    listMock.mockResolvedValue(fixtureFavorites());

    await renderScreen();

    expect(has(`favorite-duration-${TORTILLA.recipeId}`)).toBe(true);
    expect(has(`favorite-duration-${LENTEJAS.recipeId}`)).toBe(false);
  });

  it('says there are no favorites when the server lists none', async () => {
    listMock.mockResolvedValue([]);

    await renderScreen();

    expect(has('favorites-empty')).toBe(true);
    expect(has('favorites-error')).toBe(false);
  });

  it('shows a loading state until the server answers', async () => {
    let answer: (favorites: ReturnType<typeof fixtureFavorites>) => void = () => {};
    listMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    await renderScreen();
    expect(has('favorites-loading')).toBe(true);
    expect(has('favorites-empty')).toBe(false);

    await act(async () => answer(fixtureFavorites()));
    expect(has('favorites-loading')).toBe(false);
  });

  it('shows the error and reads again on retry', async () => {
    listMock.mockRejectedValueOnce(new ApiError('recipe_not_found', 'nope', 404));
    listMock.mockResolvedValueOnce(fixtureFavorites());

    await renderScreen();
    expect(has('favorites-error')).toBe(true);
    expect(has('favorites-empty')).toBe(false);

    await press('favorites-retry');

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(has('favorites-error')).toBe(false);
    expect(texts()).toContain('Tortilla de papas');
  });

  it('removes the row at once when unfavorited and tells the server', async () => {
    listMock.mockResolvedValue(fixtureFavorites());
    removeMock.mockResolvedValue(undefined);
    await renderScreen();

    await press(`favorite-remove-${TORTILLA.recipeId}`);

    expect(removeMock).toHaveBeenCalledWith(TORTILLA.recipeId);
    expect(has(`favorite-open-${TORTILLA.recipeId}`)).toBe(false);
    expect(has(`favorite-open-${LENTEJAS.recipeId}`)).toBe(true);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('puts the row back when the server refuses the unfavorite', async () => {
    listMock.mockResolvedValue(fixtureFavorites());
    removeMock.mockRejectedValue(new ApiError('recipe_not_found', 'nope', 404));
    await renderScreen();

    await press(`favorite-remove-${TORTILLA.recipeId}`);

    expect(has(`favorite-open-${TORTILLA.recipeId}`)).toBe(true);
  });

  it('opens the recipe of a row', async () => {
    listMock.mockResolvedValue(fixtureFavorites());
    await renderScreen();

    await press(`favorite-open-${LENTEJAS.recipeId}`);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recipe/[id]',
      params: { id: LENTEJAS.recipeId },
    });
  });

  it('goes back', async () => {
    listMock.mockResolvedValue([]);
    await renderScreen();

    await press('favorites-back');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
