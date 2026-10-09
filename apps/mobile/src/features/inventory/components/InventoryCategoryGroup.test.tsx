/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import { ONION } from '../mocks';
import type { InventoryItem } from '../types';
import { InventoryCategoryGroup } from './InventoryCategoryGroup';

jest.mock('@/components', () => {
  const { View } = require('react-native');

  return { ShadowSurface: View };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      textBlack: '#111111',
      textDark: '#222222',
    },
  }),
}));

const TOMATO: InventoryItem = {
  ...ONION,
  id: 'inv-tomato',
  name: 'Tomate',
  quantityMilli: 2_000,
};

function renderGroup() {
  const onEditItem = jest.fn();
  const onDeleteItem = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <InventoryCategoryGroup
        category="verduras"
        items={[ONION, TOMATO]}
        onEditItem={onEditItem}
        onDeleteItem={onDeleteItem}
      />
    );
  });

  return { root: tree!.root, onEditItem, onDeleteItem };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  );
}

function getHeader(root: ReactTestInstance): ReactTestInstance {
  return getButton(root, 'Verduras, 2 productos');
}

function toggle(root: ReactTestInstance) {
  act(() => {
    getHeader(root).props.onPress();
  });
}

function countSurfacesInCategoryColor(root: ReactTestInstance): number {
  return root
    .findAllByType(View)
    .filter(
      (view) =>
        StyleSheet.flatten(view.props.style)?.backgroundColor === INVENTORY_CATEGORY_COLORS.verduras
    ).length;
}

describe('InventoryCategoryGroup', () => {
  it('starts expanded with its label, item count and rows', () => {
    const { root } = renderGroup();

    expect(getHeader(root).props.accessibilityRole).toBe('button');
    expect(getHeader(root).props.accessibilityState).toEqual({ expanded: true });
    expect(getTexts(root)).toEqual(expect.arrayContaining(['Verduras', 2, 'Cebolla', 'Tomate']));
  });

  it('hides its rows when the header is pressed and shows them again on the next press', () => {
    const { root } = renderGroup();

    toggle(root);

    expect(getHeader(root).props.accessibilityState).toEqual({ expanded: false });
    expect(getTexts(root)).toEqual(['Verduras', 2]);

    toggle(root);

    expect(getHeader(root).props.accessibilityState).toEqual({ expanded: true });
    expect(getTexts(root)).toEqual(expect.arrayContaining(['Cebolla', 'Tomate']));
  });

  it('leaves a single strip in the category color while collapsed', () => {
    const { root } = renderGroup();

    toggle(root);

    expect(countSurfacesInCategoryColor(root)).toBe(1);
  });

  it('reports which item a row wants to edit or delete', () => {
    const { root, onEditItem, onDeleteItem } = renderGroup();

    act(() => {
      getButton(root, 'Editar Cebolla').props.onPress();
    });
    act(() => {
      getButton(root, 'Borrar Tomate').props.onPress();
    });

    expect(onEditItem).toHaveBeenCalledTimes(1);
    expect(onEditItem).toHaveBeenCalledWith(ONION);
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
    expect(onDeleteItem).toHaveBeenCalledWith(TOMATO);
  });
});
