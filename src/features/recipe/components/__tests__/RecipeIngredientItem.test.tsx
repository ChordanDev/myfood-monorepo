import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { RecipeIngredientRow } from '../../domain/recipeIngredients';
import { RecipeIngredientItem } from '../RecipeIngredientItem';

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      alert: '#aa0000',
      textBlack: '#111111',
    },
  }),
}));

const BASE_ROW: RecipeIngredientRow = {
  ingredientId: 'i2',
  name: 'Pollo (pechuga)',
  quantityLabel: '200 g',
  requiredAmount: 200,
  availableAmount: 50,
  missingAmount: 150,
  unit: 'gramos',
  status: 'missing',
};

function render(row: RecipeIngredientRow, onRequest = jest.fn()) {
  let tree: ReactTestRenderer;

  act(() => {
    tree = create(<RecipeIngredientItem row={row} onRequest={onRequest} />);
  });

  return { tree: tree!, onRequest };
}

function renderedTexts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => String(node.props.children));
}

describe('RecipeIngredientItem', () => {
  it('shows the quantity and the name of the ingredient', () => {
    const { tree } = render(BASE_ROW);

    expect(tree.root.findByProps({ testID: 'recipe-ingredient-row-i2' })).toBeTruthy();
    expect(renderedTexts(tree)).toEqual(expect.arrayContaining(['200 g', 'Pollo (pechuga)']));
  });

  it('marks an ingredient covered by the inventory as in stock, without an add action', () => {
    const { tree } = render({ ...BASE_ROW, status: 'in_stock' });

    expect(renderedTexts(tree)).toContain('En stock');
    expect(tree.root.findAllByProps({ testID: 'recipe-ingredient-add-i2' })).toHaveLength(0);
  });

  it('offers to add a missing ingredient and reports the row when pressed', () => {
    const { tree, onRequest } = render(BASE_ROW);
    const addButton = tree.root.findByProps({ testID: 'recipe-ingredient-add-i2' });

    expect(renderedTexts(tree)).toContain('Falta · agregar');

    act(() => {
      addButton.props.onPress();
    });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(BASE_ROW);
  });

  it('shows a requested ingredient as already in the list, without an add action', () => {
    const { tree, onRequest } = render({ ...BASE_ROW, status: 'requested' });

    expect(renderedTexts(tree)).toContain('En la lista');
    expect(tree.root.findAllByProps({ testID: 'recipe-ingredient-add-i2' })).toHaveLength(0);
    expect(onRequest).not.toHaveBeenCalled();
  });
});
