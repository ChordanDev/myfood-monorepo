/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { BestOffer, PlannedShoppingListItem, ShoppingListItem } from '../types';
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

// Returns the colors as the style and records the options, so `immediateKey` can be asserted.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
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

  return { tree: tree!, root: tree!.root, onToggle };
}

// The `immediateKey` each animated part of the row was last rendered with. A part whose key
// changes between two renders applies its new colors at once instead of crossfading.
function getImmediateKeys() {
  const calls = jest.mocked(useAnimatedThemeStyle).mock.calls;
  const [name, meta] = calls.filter(([colors]) => 'color' in colors);
  const [checkbox] = calls.filter(([colors]) => 'backgroundColor' in colors);

  return {
    name: name[1]?.immediateKey,
    meta: meta[1]?.immediateKey,
    checkbox: checkbox[1]?.immediateKey,
  };
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
    jest.mocked(useAnimatedThemeStyle).mockClear();
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

  it.each(['name', 'meta', 'checkbox'] as const)(
    'applies the purchased look of the %s at once, without crossfading',
    (part) => {
      const { tree, onToggle } = renderRow(CHEESE, CHEESE_OFFER);
      const needed = getImmediateKeys();
      jest.mocked(useAnimatedThemeStyle).mockClear();

      act(() => {
        tree.update(
          <ShoppingItemRow
            item={{ ...CHEESE, status: 'purchased' }}
            bestOffer={CHEESE_OFFER}
            onToggle={onToggle}
          />
        );
      });
      const purchased = getImmediateKeys();

      expect(needed[part]).toBeDefined();
      expect(purchased[part]).toBeDefined();
      expect(purchased[part]).not.toBe(needed[part]);
    }
  );

  it('reports the id of the pressed item, with a light haptic', () => {
    const { root, onToggle } = renderRow(CHEESE, CHEESE_OFFER);

    act(() => {
      getCheckboxRow(root).props.onPress();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('planned:cheese');
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('is one checkbox that reads both lines and is unchecked while the item is needed', () => {
    const { root } = renderRow(CHEESE, CHEESE_OFFER);

    expect(getCheckboxRow(root).props).toEqual(
      expect.objectContaining({
        accessibilityLabel: '300 g · Queso cremoso, Día · $3.200',
        accessibilityState: { checked: false },
      })
    );
  });

  it('reads that there is no price when the item has no offer', () => {
    const { root } = renderRow(CHEESE);

    expect(getCheckboxRow(root).props.accessibilityLabel).toBe('300 g · Queso cremoso, Sin precio');
  });

  it('is a checked checkbox once the item is purchased', () => {
    const { root } = renderRow({ ...CHEESE, status: 'purchased' }, CHEESE_OFFER);

    expect(getCheckboxRow(root).props.accessibilityState).toEqual({ checked: true });
  });
});
