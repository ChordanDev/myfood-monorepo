/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import { useInventoryStore, useMealPlanStore, useShoppingListStore } from '@/store';
import { ShoppingScreen } from './ShoppingScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return {
    __esModule: true,
    default: { Text, View },
    Easing: { out: (curve: unknown) => curve, quad: 'quad' },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});

// Only what the screen uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: jest.requireActual('@/components/SafeAreaContent').SafeAreaContent,
  SegmentedSwitcher: jest.requireActual('@/components/SegmentedSwitcher').SegmentedSwitcher,
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('lucide-react-native', () => ({ Calendar: 'Calendar', Check: 'Check' }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eeeeee',
      colorBlack: '#000000',
      colorDark: '#111111',
      colorLight: '#999999',
      colorMedium: '#444444',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      textBlack: '#111111',
      textDark: '#222222',
      textLight: '#eeeeee',
      textMedium: '#bbbbbb',
    },
  }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

// Chicken and tomato on the 6th, spinach on the 12th. Nothing is in stock.
const RECIPES = [
  {
    id: 'r1',
    ingredients: [
      { ingredientId: 'i2', amount: 200 },
      { ingredientId: 'i3', amount: 2 },
    ],
  },
  { id: 'r2', ingredients: [{ ingredientId: 'i7', amount: 100 }] },
];

const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-10-06', type: 'almuerzo', recipeId: 'r1', isCooked: false },
  { id: 'mp2', date: '2026-10-12', type: 'cena', recipeId: 'r2', isCooked: false },
];

let tree: ReturnType<typeof create> | undefined;

function renderScreen(): ReactTestInstance {
  act(() => {
    tree = create(<ShoppingScreen />);
  });

  return tree!.root;
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getPressables(root: ReactTestInstance, role: 'button' | 'checkbox') {
  return root.findAll(
    (node) => node.props.accessibilityRole === role && typeof node.props.onPress === 'function'
  );
}

function press(root: ReactTestInstance, role: 'button' | 'checkbox', label: string) {
  const target = getPressables(root, role).find(
    (candidate) => candidate.props.accessibilityLabel === label
  );

  if (!target) {
    throw new Error(`No ${role} labelled "${label}"`);
  }

  act(() => {
    target.props.onPress();
  });
}

beforeEach(() => {
  useMealPlanStore.setState({
    entries: PLAN,
    recipes: RECIPES as MasterRecipe[],
  });
  useInventoryStore.setState({ items: [], ingredients: MOCK_INGREDIENTS });
  useShoppingListStore.setState({
    purchases: {},
    removedIds: [],
    manualItems: [],
    groupingMode: 'category',
  });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

describe('ShoppingScreen', () => {
  it('lists the plan by category under the date, the switcher, the title and the counter', () => {
    const root = renderScreen();

    expect(getTexts(root)).toEqual([
      'Hasta 12 Oct',
      'Por categoría',
      'Por súper',
      'COMPRAS',
      '3 ítems · 0 comprados',
      'Verduras',
      'Marcar todos',
      '100 g · Espinaca',
      'Sin precio',
      '2 u · Tomate',
      'Coto · $1.100',
      'Proteínas',
      'Marcar todos',
      '200 g · Pollo (Pechuga)',
      'Día · $1.520',
    ]);
  });

  it('shows the date as plain text: the only buttons are the grouping options', () => {
    const root = renderScreen();

    expect(getPressables(root, 'button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Por categoría',
      'Por súper',
    ]);
  });

  it('marks the pressed row as purchased and updates the counter', () => {
    const root = renderScreen();

    press(root, 'checkbox', '2 u · Tomate');

    expect(getTexts(root)).toContain('3 ítems · 1 comprado');
    expect(
      getPressables(root, 'checkbox')
        .filter((checkbox) => checkbox.props.accessibilityState.checked)
        .map((checkbox) => checkbox.props.accessibilityLabel)
    ).toEqual(['2 u · Tomate']);
  });

  it('marks a whole group from its "Marcar todos"', () => {
    const root = renderScreen();

    press(root, 'checkbox', 'Marcar todos, Verduras');

    expect(getTexts(root)).toContain('3 ítems · 2 comprados');
    expect(
      getPressables(root, 'checkbox')
        .filter((checkbox) => checkbox.props.accessibilityState.checked)
        .map((checkbox) => checkbox.props.accessibilityLabel)
    ).toEqual(['Marcar todos, Verduras', '100 g · Espinaca', '2 u · Tomate']);
  });

  it('regroups by supermarket from the switcher', () => {
    const root = renderScreen();

    press(root, 'button', 'Por súper');

    const titles = ['Coto', 'Día', 'Sin súper'];
    expect(getTexts(root).filter((text) => titles.includes(text))).toEqual(titles);
    expect(getTexts(root)).not.toContain('Verduras');
  });

  it('clears the tab bar itself, without letting iOS add the safe area again', () => {
    const root = renderScreen();
    const list = root.findByType(ScrollView);

    expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(
      34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + 14
    );
  });

  it('says there is nothing to buy, with no date, when the plan is empty', () => {
    useMealPlanStore.setState({ entries: [] });

    const root = renderScreen();

    expect(getTexts(root)).toEqual([
      'Por categoría',
      'Por súper',
      'COMPRAS',
      '0 ítems · 0 comprados',
      'No hay nada para comprar',
    ]);
    expect(root.findAllByType(ScrollView)).toEqual([]);
  });
});
