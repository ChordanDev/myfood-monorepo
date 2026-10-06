/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { withOpacity } from '@/utils/colors';
import type { PlannedShoppingListItem, ShoppingListItem } from '@/types/domain';
import type { BestOffer } from '../types';
import { ShoppingItemRow } from './ShoppingItemRow';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('lucide-react-native', () => ({ Check: 'Check' }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(),
}));

const mockTheme = {
  colorMedium: '#444444',
  primaryAccent: '#ff6600',
  textBlack: '#111111',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

const CHEESE: PlannedShoppingListItem = {
  id: 'planned:cheese',
  source: 'planned_meal',
  status: 'needed',
  name: 'Queso cremoso',
  ingredientId: 'cheese',
  amountToBuy: 300,
  unit: 'gramos',
  category: 'lacteos',
};

const CHEESE_OFFER: BestOffer = { supermarket: 'Día', unitPrice: 10.67, price: 3200 };

function renderRow(item: ShoppingListItem, bestOffer?: BestOffer) {
  const onToggle = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<ShoppingItemRow item={item} bestOffer={bestOffer} onToggle={onToggle} />);
  });

  return { root: tree!.root, onToggle };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getCheckboxRow(root: ReactTestInstance) {
  const [row] = root.findAll(
    (node) =>
      node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function'
  );

  return row;
}

function getLineStyles(root: ReactTestInstance) {
  return root.findAllByType(Text).map((node) => StyleSheet.flatten(node.props.style));
}

function getCheckboxStyle(root: ReactTestInstance) {
  const [checkbox] = root.findAll((node) => node.props.testID === 'shopping-checkbox');

  return StyleSheet.flatten(checkbox.props.style);
}

describe('ShoppingItemRow', () => {
  beforeEach(() => {
    jest.mocked(Haptics.impactAsync).mockClear();
  });

  it('renders the quantity and name line above the supermarket and price line', () => {
    const { root } = renderRow(CHEESE, CHEESE_OFFER);

    expect(getTexts(root)).toEqual(['300 g · Queso cremoso', 'Día · $3.200']);
  });

  it('says there is no price for an item without an offer', () => {
    const { root } = renderRow({
      id: 'manual:1',
      source: 'manual',
      status: 'needed',
      name: 'Papel de cocina',
    });

    expect(getTexts(root)).toEqual(['Papel de cocina', 'Sin precio']);
  });

  it('shows a needed item in full ink next to an empty checkbox', () => {
    const { root } = renderRow(CHEESE, CHEESE_OFFER);
    const [name, meta] = getLineStyles(root);

    expect(name).toEqual(expect.objectContaining({ color: mockTheme.textBlack }));
    expect(name.textDecorationLine).not.toBe('line-through');
    expect(meta).toEqual(expect.objectContaining({ color: withOpacity(mockTheme.textBlack, 0.6) }));
    expect(getCheckboxStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.primaryAccent, 0),
        borderColor: mockTheme.colorMedium,
        borderWidth: 1.5,
      })
    );
    expect(root.findAllByType(Check)).toEqual([]);
  });

  it('strikes through and dims a purchased item, and checks its checkbox', () => {
    const { root } = renderRow({ ...CHEESE, status: 'purchased' }, CHEESE_OFFER);
    const [name, meta] = getLineStyles(root);
    const dimmed = withOpacity(mockTheme.textBlack, 0.45);

    expect(name).toEqual(
      expect.objectContaining({ color: dimmed, textDecorationLine: 'line-through' })
    );
    expect(meta).toEqual(expect.objectContaining({ color: dimmed }));
    expect(getCheckboxStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.primaryAccent, 0.7),
        borderColor: mockTheme.primaryAccent,
      })
    );
    expect(root.findAllByType(Check).map((icon) => icon.props)).toEqual([
      { color: mockTheme.textBlack, size: 14, strokeWidth: 3 },
    ]);
  });

  it('reports the id of the pressed item, with a light haptic', () => {
    const { root, onToggle } = renderRow(CHEESE, CHEESE_OFFER);

    act(() => {
      getCheckboxRow(root).props.onPress();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('planned:cheese');
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('is one checkbox named after the item and unchecked while it is needed', () => {
    const { root } = renderRow(CHEESE, CHEESE_OFFER);

    expect(getCheckboxRow(root).props).toEqual(
      expect.objectContaining({
        accessibilityLabel: '300 g · Queso cremoso',
        accessibilityState: { checked: false },
      })
    );
  });

  it('is a checked checkbox once the item is purchased', () => {
    const { root } = renderRow({ ...CHEESE, status: 'purchased' }, CHEESE_OFFER);

    expect(getCheckboxRow(root).props.accessibilityState).toEqual({ checked: true });
  });
});
