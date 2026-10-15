/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import { MILK, ONION } from '../fixtures';
import { InventorySection } from './InventorySection';

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

function renderSection() {
  const onEditItem = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <InventorySection title="Por vencer" items={[ONION, MILK]} onEditItem={onEditItem} />
    );
  });

  return { root: tree!.root, onEditItem };
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
  return getButton(root, 'Por vencer, 2 productos');
}

function toggle(root: ReactTestInstance) {
  act(() => {
    getHeader(root).props.onPress();
  });
}

function countSurfacesInColor(root: ReactTestInstance, color: string): number {
  return root
    .findAllByType(View)
    .filter((view) => StyleSheet.flatten(view.props.style)?.backgroundColor === color).length;
}

describe('InventorySection', () => {
  it('starts expanded with its title, item count and rows', () => {
    const { root } = renderSection();

    expect(getHeader(root).props.accessibilityRole).toBe('button');
    expect(getHeader(root).props.accessibilityState).toEqual({ expanded: true });
    expect(getTexts(root)).toEqual(expect.arrayContaining(['Por vencer', 2, 'Cebolla', 'Leche']));
  });

  it('counts a single item in the singular', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InventorySection title="Vencidos" items={[ONION]} onEditItem={jest.fn()} />);
    });

    expect(getButton(tree!.root, 'Vencidos, 1 producto')).toBeTruthy();
  });

  it('hides its rows when the header is pressed and shows them again on the next press', () => {
    const { root } = renderSection();

    toggle(root);

    expect(getHeader(root).props.accessibilityState).toEqual({ expanded: false });
    expect(getTexts(root)).toEqual(['Por vencer', 2]);

    toggle(root);

    expect(getHeader(root).props.accessibilityState).toEqual({ expanded: true });
    expect(getTexts(root)).toEqual(expect.arrayContaining(['Cebolla', 'Leche']));
  });

  it('leaves a single strip in the color of its first row while collapsed', () => {
    const { root } = renderSection();

    toggle(root);

    expect(countSurfacesInColor(root, INVENTORY_CATEGORY_COLORS.verduras)).toBe(1);
    expect(countSurfacesInColor(root, INVENTORY_CATEGORY_COLORS.lacteos)).toBe(0);
  });

  it('reports which item a row wants to edit', () => {
    const { root, onEditItem } = renderSection();

    act(() => {
      getButton(root, 'Editar Leche').props.onPress();
    });

    expect(onEditItem).toHaveBeenCalledTimes(1);
    expect(onEditItem).toHaveBeenCalledWith(MILK);
  });
});
