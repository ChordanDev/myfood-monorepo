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

const MILK: InventoryItem = {
  ...MILK_LOT,
  name: 'Leche entera',
  quantityMilli: 1_000_000,
  notes: null,
};

function renderRow(item: InventoryItem) {
  const onEdit = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<InventoryRow item={item} onEdit={onEdit} />);
  });

  return { tree: tree!, root: tree!.root, onEdit };
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

  it('marks a leftover', () => {
    const { root } = renderRow({ ...MILK, isLeftover: true });

    expect(getTexts(root)).toContain('Sobra');
  });

  it('does not mark a lot that is not a leftover', () => {
    const { root } = renderRow(MILK);

    expect(getTexts(root)).not.toContain('Sobra');
  });

  it('shows the notes under the name, on a single line', () => {
    const { root } = renderRow({ ...MILK, notes: 'Abierta, usar pronto' });

    const notes = root
      .findAllByType(Text)
      .find((node) => node.props.children === 'Abierta, usar pronto');

    expect(getTexts(root).slice(0, 3)).toEqual(['1 L', 'Leche entera', 'Abierta, usar pronto']);
    expect(notes!.props.numberOfLines).toBe(1);
  });

  it('shows only the name when the lot has no notes', () => {
    const { root } = renderRow(MILK);

    expect(getTexts(root)).toEqual(['1 L', 'Leche entera']);
  });

  it('edits through a button labelled with the item name, its only action', () => {
    const { root, onEdit } = renderRow(MILK);

    const buttons = root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
    );
    const editButton = getButton(root, 'Editar Leche entera');

    expect(buttons).toEqual([editButton]);

    act(() => {
      editButton.props.onPress();
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
