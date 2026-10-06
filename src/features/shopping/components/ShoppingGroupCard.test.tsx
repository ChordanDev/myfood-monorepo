/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import type {
  BestOffer,
  PlannedShoppingListItem,
  ShoppingGroup,
  ShoppingItemStatus,
} from '../types';
import { ShoppingGroupCard } from './ShoppingGroupCard';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

// Only the surface the card uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('lucide-react-native', () => ({ Check: 'Check' }));

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

// Returns the colors as the style and records the options, so `immediateKey` can be asserted.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
}));

const HEADER_LABEL = 'Marcar todos, Verduras';

function vegetable(
  ingredientId: string,
  name: string,
  status: ShoppingItemStatus
): PlannedShoppingListItem {
  return {
    id: `planned:${ingredientId}`,
    source: 'planned_meal',
    status,
    name,
    ingredientId,
    amountToBuy: 2,
    unit: 'unidades',
    category: 'verduras',
  };
}

function vegetables(statuses: [ShoppingItemStatus, ShoppingItemStatus]): ShoppingGroup {
  return {
    key: 'verduras',
    title: 'Verduras',
    items: [vegetable('onion', 'Cebolla', statuses[0]), vegetable('tomato', 'Tomate', statuses[1])],
  };
}

const BEST_OFFERS: Record<string, BestOffer> = {
  'planned:onion': { supermarket: 'Carrefour', unitPrice: 450, price: 900 },
};

function renderCard(group: ShoppingGroup) {
  const onToggleItem = jest.fn();
  const onRemoveItem = jest.fn();
  const onToggleAll = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ShoppingGroupCard
        group={group}
        bestOffers={BEST_OFFERS}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        onToggleAll={onToggleAll}
      />
    );
  });

  return { root: tree!.root, onToggleItem, onRemoveItem, onToggleAll };
}

function getViewStyles(root: ReactTestInstance) {
  return root.findAllByType(View).map((view) => StyleSheet.flatten(view.props.style) ?? {});
}

// The `immediateKey` of every checkbox in the card, the "Marcar todos" one first.
function getCheckboxImmediateKeys() {
  return jest
    .mocked(useAnimatedThemeStyle)
    .mock.calls.filter(([colors]) => 'borderColor' in colors)
    .map(([, options]) => options?.immediateKey);
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getCheckboxes(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) =>
      node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function'
  );
}

function getCheckbox(root: ReactTestInstance, label: string): ReactTestInstance {
  const checkbox = getCheckboxes(root).find(
    (candidate) => candidate.props.accessibilityLabel === label
  );

  if (!checkbox) {
    throw new Error(`No checkbox labelled "${label}"`);
  }

  return checkbox;
}

describe('ShoppingGroupCard', () => {
  beforeEach(() => {
    jest.mocked(Haptics.impactAsync).mockClear();
    jest.mocked(useAnimatedThemeStyle).mockClear();
  });

  it('renders the group title, the mark-all label and one row per item, in order', () => {
    const { root } = renderCard(vegetables(['needed', 'purchased']));

    expect(getTexts(root)).toEqual([
      'Verduras',
      'Marcar todos',
      '2 u · Cebolla',
      'Carrefour · $900',
      '2 u · Tomate',
      'Sin precio',
    ]);
    expect(getCheckboxes(root).map((checkbox) => checkbox.props.accessibilityLabel)).toEqual([
      HEADER_LABEL,
      '2 u · Cebolla, Carrefour · $900',
      '2 u · Tomate, Sin precio',
    ]);
  });

  it.each<[ShoppingItemStatus, ShoppingItemStatus]>([
    ['needed', 'needed'],
    ['needed', 'purchased'],
    ['purchased', 'needed'],
  ])('leaves "Marcar todos" unchecked while the rows are %s and %s', (...statuses) => {
    const { root } = renderCard(vegetables(statuses));
    const header = getCheckbox(root, HEADER_LABEL);

    expect(header.props.accessibilityState).toEqual({ checked: false });
    expect(header.findAllByType(Check)).toEqual([]);
  });

  it('checks "Marcar todos" once every row is purchased', () => {
    const { root } = renderCard(vegetables(['purchased', 'purchased']));
    const header = getCheckbox(root, HEADER_LABEL);

    expect(header.props.accessibilityState).toEqual({ checked: true });
    expect(header.findAllByType(Check)).toHaveLength(1);
  });

  it('checks "Marcar todos" at once, without crossfading its box', () => {
    renderCard(vegetables(['needed', 'purchased']));
    const [unchecked] = getCheckboxImmediateKeys();
    jest.mocked(useAnimatedThemeStyle).mockClear();

    renderCard(vegetables(['purchased', 'purchased']));
    const [checked] = getCheckboxImmediateKeys();

    expect(unchecked).toBeDefined();
    expect(checked).toBeDefined();
    expect(checked).not.toBe(unchecked);
  });

  it('sits on the light surface of the palette, animated with it', () => {
    const { root } = renderCard(vegetables(['needed', 'purchased']));

    expect(getViewStyles(root)).toContainEqual(
      expect.objectContaining({ backgroundColor: mockTheme.colorLight, borderRadius: 21 })
    );
    // No immediate key: a palette change crossfades the surface.
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ backgroundColor: mockTheme.colorLight });
  });

  it('keeps the touch area of "Marcar todos" clear of the first row', () => {
    const { root } = renderCard(vegetables(['needed', 'purchased']));
    const { hitSlop } = getCheckbox(root, HEADER_LABEL).props;
    // The header is the only block of the card that is spaced from what follows it.
    const [gapToFirstRow] = getViewStyles(root).flatMap((style) => style.marginBottom ?? []);

    expect(hitSlop).toEqual({ top: 10, right: 10, bottom: expect.any(Number), left: 10 });
    expect(hitSlop.bottom).toBeLessThanOrEqual(gapToFirstRow as number);
  });

  it('reports the group key when "Marcar todos" is pressed, with a light haptic', () => {
    const { root, onToggleAll, onToggleItem } = renderCard(vegetables(['needed', 'purchased']));

    act(() => {
      getCheckbox(root, HEADER_LABEL).props.onPress();
    });

    expect(onToggleAll).toHaveBeenCalledTimes(1);
    expect(onToggleAll).toHaveBeenCalledWith('verduras');
    expect(onToggleItem).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('reports the id of a pressed row', () => {
    const { root, onToggleAll, onToggleItem } = renderCard(vegetables(['needed', 'purchased']));

    act(() => {
      getCheckbox(root, '2 u · Tomate, Sin precio').props.onPress();
    });

    expect(onToggleItem).toHaveBeenCalledTimes(1);
    expect(onToggleItem).toHaveBeenCalledWith('planned:tomato');
    expect(onToggleAll).not.toHaveBeenCalled();
  });

  it('reports the id of a long-pressed row to remove it', () => {
    const { root, onRemoveItem, onToggleItem, onToggleAll } = renderCard(
      vegetables(['needed', 'purchased'])
    );

    act(() => {
      getCheckbox(root, '2 u · Tomate, Sin precio').props.onLongPress();
    });

    expect(onRemoveItem).toHaveBeenCalledTimes(1);
    expect(onRemoveItem).toHaveBeenCalledWith('planned:tomato');
    expect(onToggleItem).not.toHaveBeenCalled();
    expect(onToggleAll).not.toHaveBeenCalled();
  });
});
