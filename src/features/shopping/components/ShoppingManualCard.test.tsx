/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { Plus } from 'lucide-react-native';
import { withOpacity } from '@/utils/colors';
import type { ManualShoppingListItem, ShoppingItemStatus } from '../types';
import { ShoppingManualCard } from './ShoppingManualCard';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

// Only the surface the card uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('lucide-react-native', () => ({ Check: 'Check', Plus: 'Plus' }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  impactAsync: jest.fn(),
}));

const mockTheme = {
  colorLight: '#999999',
  colorMedium: '#444444',
  primaryAccent: '#ff6600',
  textBlack: '#111111',
  textDark: '#222222',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

const ADD_LABEL = 'Agregar a la lista';
const EMPTY_HINT = 'Todavía no agregaste nada.';

function manualItem(sequence: number, name: string, status: ShoppingItemStatus = 'needed') {
  return { id: `manual:${sequence}`, source: 'manual', status, name } as ManualShoppingListItem;
}

const ITEMS = [manualItem(1, 'Papel de cocina'), manualItem(2, 'Velas', 'purchased')];

function renderCard(items: ManualShoppingListItem[]) {
  const onToggleItem = jest.fn();
  const onRemoveItem = jest.fn();
  const onAdd = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ShoppingManualCard
        items={items}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        onAdd={onAdd}
      />
    );
  });

  return { root: tree!.root, onToggleItem, onRemoveItem, onAdd };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getPressables(root: ReactTestInstance, role: 'button' | 'checkbox') {
  return root.findAll(
    (node) => node.props.accessibilityRole === role && typeof node.props.onPress === 'function'
  );
}

function getLabels(root: ReactTestInstance, role: 'button' | 'checkbox'): string[] {
  return getPressables(root, role).map((pressable) => pressable.props.accessibilityLabel);
}

describe('ShoppingManualCard', () => {
  it('lists the manual items by name, without a price', () => {
    const { root } = renderCard(ITEMS);

    expect(getTexts(root)).toEqual([
      'Agregados a mano',
      'Papel de cocina',
      'Sin precio',
      'Velas',
      'Sin precio',
    ]);
  });

  it('has one checkbox per item and no "Marcar todos"', () => {
    const { root } = renderCard(ITEMS);

    expect(getLabels(root, 'checkbox')).toEqual([
      'Papel de cocina, Sin precio',
      'Velas, Sin precio',
    ]);
    expect(
      getPressables(root, 'checkbox').map((row) => row.props.accessibilityState.checked)
    ).toEqual([false, true]);
  });

  it('shows a muted hint instead of rows while nothing was added', () => {
    const { root } = renderCard([]);
    const [, hint] = root.findAllByType(Text);

    expect(getTexts(root)).toEqual(['Agregados a mano', EMPTY_HINT]);
    expect(StyleSheet.flatten(hint.props.style)).toEqual(
      expect.objectContaining({
        color: withOpacity(mockTheme.textBlack, 0.6),
        fontSize: 12,
        lineHeight: 16,
      })
    );
    expect(getLabels(root, 'checkbox')).toEqual([]);
  });

  it.each([[ITEMS], [[]]])('asks to add an item from its plus button', (items) => {
    const { root, onAdd } = renderCard(items);

    expect(getLabels(root, 'button')).toEqual([ADD_LABEL]);

    act(() => {
      getPressables(root, 'button')[0].props.onPress();
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('draws the plus in the title ink, inside a touch target of at least 44 pt', () => {
    const { root } = renderCard(ITEMS);
    const [button] = getPressables(root, 'button');
    const [icon] = button.findAllByType(Plus);
    const { hitSlop } = button.props;

    expect(icon.props.color).toBe(mockTheme.textDark);
    expect(icon.props.size + hitSlop.left + hitSlop.right).toBeGreaterThanOrEqual(44);
    expect(icon.props.size + hitSlop.top + hitSlop.bottom).toBeGreaterThanOrEqual(44);
    // The first row starts 6 pt below the header: the target must not reach into it.
    expect(hitSlop.bottom).toBeLessThanOrEqual(6);
  });

  it('reports the id of a pressed row to toggle it, and of a long-pressed one to remove it', () => {
    const { root, onToggleItem, onRemoveItem, onAdd } = renderCard(ITEMS);
    const [, candles] = getPressables(root, 'checkbox');

    act(() => {
      candles.props.onPress();
    });

    expect(onToggleItem).toHaveBeenCalledWith('manual:2');
    expect(onRemoveItem).not.toHaveBeenCalled();

    act(() => {
      candles.props.onLongPress();
    });

    expect(onRemoveItem).toHaveBeenCalledWith('manual:2');
    expect(onToggleItem).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
