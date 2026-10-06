/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import type { PlannedShoppingListItem, ShoppingItemStatus } from '@/types/domain';
import type { BestOffer, ShoppingGroup } from '../types';
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
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorLight: '#999999',
      colorMedium: '#444444',
      primaryAccent: '#ff6600',
      textBlack: '#111111',
      textDark: '#222222',
    },
  }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
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
  const onToggleAll = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ShoppingGroupCard
        group={group}
        bestOffers={BEST_OFFERS}
        onToggleItem={onToggleItem}
        onToggleAll={onToggleAll}
      />
    );
  });

  return { root: tree!.root, onToggleItem, onToggleAll };
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
      '2 u · Cebolla',
      '2 u · Tomate',
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
      getCheckbox(root, '2 u · Tomate').props.onPress();
    });

    expect(onToggleItem).toHaveBeenCalledTimes(1);
    expect(onToggleItem).toHaveBeenCalledWith('planned:tomato');
    expect(onToggleAll).not.toHaveBeenCalled();
  });
});
