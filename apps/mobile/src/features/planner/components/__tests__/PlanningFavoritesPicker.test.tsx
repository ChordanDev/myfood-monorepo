import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { FavoriteSummary } from '@/features/favorites';
import { PlanningFavoritesPicker } from '../PlanningFavoritesPicker';

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorBlack: '#050505',
      colorLight: '#eeeeee',
      primaryAccent: '#ff6600',
      textDark: '#222222',
    },
  }),
}));

function favorite(recipeId: string, name: string): FavoriteSummary {
  return { recipeId, name, mainIngredients: [], durationMinutes: null };
}

const FAVORITES = [favorite('recipe-1', 'Lentejas'), favorite('recipe-2', 'Milanesa')];

let tree: ReturnType<typeof create>;

function render(selectedRecipeIds: string[], favorites = FAVORITES, onToggle = jest.fn()) {
  act(() => {
    tree = create(
      <PlanningFavoritesPicker
        favorites={favorites}
        selectedRecipeIds={selectedRecipeIds}
        onToggle={onToggle}
      />
    );
  });
  return onToggle;
}

function byTestId(testID: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.props.testID === testID)[0];
}

afterEach(() => {
  act(() => tree.unmount());
});

describe('PlanningFavoritesPicker', () => {
  it('draws one checkbox per favorite, checked only for the selected ones', () => {
    render(['recipe-2']);

    expect(byTestId('planner-favorite-recipe-1')?.props).toMatchObject({
      accessibilityRole: 'checkbox',
      accessibilityState: { checked: false },
    });
    expect(byTestId('planner-favorite-recipe-2')?.props).toMatchObject({
      accessibilityRole: 'checkbox',
      accessibilityState: { checked: true },
    });
  });

  it('names each favorite on its checkbox', () => {
    render([]);

    const labels = byTestId('planner-favorite-recipe-1')?.findAllByType(Text);
    expect(labels?.map((label) => label.props.children)).toEqual(['Lentejas']);
  });

  it('asks to toggle the favorite that was tapped', () => {
    const onToggle = render([]);

    act(() => byTestId('planner-favorite-recipe-2')?.props.onPress());

    expect(onToggle).toHaveBeenCalledWith('recipe-2');
  });

  it('draws nothing without favorites', () => {
    render([], []);

    expect(tree.toJSON()).toBeNull();
  });
});
