/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance, ReactTestRendererJSON } from 'react-test-renderer';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import { MILK as MILK_LOT } from '../mocks';
import type { InventoryItem } from '../types';
import { InventoryRow } from './InventoryRow';

jest.mock('@/components', () => {
  const { View } = require('react-native');

  return { ShadowSurface: View };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      textBlack: '#111111',
    },
  }),
}));

const MILK: InventoryItem = { ...MILK_LOT, name: 'Leche entera', quantityMilli: 1_000_000 };

function renderRow(item: InventoryItem) {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<InventoryRow item={item} onEdit={onEdit} onDelete={onDelete} />);
  });

  return { tree: tree!, root: tree!.root, onEdit, onDelete };
}

function getButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  );
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

describe('InventoryRow', () => {
  it('shows the formatted quantity before the name', () => {
    const { root } = renderRow(MILK);

    expect(getTexts(root).slice(0, 2)).toEqual(['1 L', 'Leche entera']);
  });

  it('keeps the name on a single line', () => {
    const { root } = renderRow(MILK);

    const name = root.findAllByType(Text).find((node) => node.props.children === 'Leche entera');

    expect(name!.props.numberOfLines).toBe(1);
  });

  it('paints the whole row with the color of its category', () => {
    const { tree } = renderRow({ ...MILK, category: 'verduras' });

    const surface = tree.toJSON() as ReactTestRendererJSON;

    expect(StyleSheet.flatten(surface.props.style)).toEqual(
      expect.objectContaining({ backgroundColor: INVENTORY_CATEGORY_COLORS.verduras })
    );
  });

  it('paints a category the screen does not draw with the color of the one it maps to', () => {
    const { tree } = renderRow({ ...MILK, category: 'granos' });

    const surface = tree.toJSON() as ReactTestRendererJSON;

    expect(StyleSheet.flatten(surface.props.style)).toEqual(
      expect.objectContaining({ backgroundColor: INVENTORY_CATEGORY_COLORS.almacen })
    );
  });

  it('does not tag the quantity as approximate', () => {
    const { root } = renderRow(MILK);

    expect(getTexts(root)).not.toContain('aprox.');
  });

  it('edits and deletes through buttons labelled with the item name', () => {
    const { root, onEdit, onDelete } = renderRow(MILK);

    const editButton = getButton(root, 'Editar Leche entera');
    const deleteButton = getButton(root, 'Borrar Leche entera');

    expect(editButton.props.accessibilityRole).toBe('button');
    expect(deleteButton.props.accessibilityRole).toBe('button');

    act(() => {
      editButton.props.onPress();
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    act(() => {
      deleteButton.props.onPress();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
