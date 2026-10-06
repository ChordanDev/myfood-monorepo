/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { useInventoryStore, useMealPlanStore } from '@/store';
import { useShoppingListStore } from '../store';
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

jest.mock('lucide-react-native', () => ({ Calendar: 'Calendar', Check: 'Check', Plus: 'Plus' }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  impactAsync: jest.fn(),
}));

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: false }),
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
      primaryAccentIntense: '#ff3300',
      textBlack: '#111111',
      textDark: '#222222',
      textLight: '#eeeeee',
      textMedium: '#bbbbbb',
    },
  }),
}));

// Returns the colors as the style and records the options, so `immediateKey` can be asserted.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
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

function longPress(root: ReactTestInstance, label: string) {
  const row = getPressables(root, 'checkbox').find(
    (candidate) => candidate.props.accessibilityLabel === label
  );

  if (!row) {
    throw new Error(`No row labelled "${label}"`);
  }

  act(() => {
    row.props.onLongPress();
  });
}

// A boolean, not the node: a failed assertion on a test instance prints its whole tree.
function isAddSheetOpen(root: ReactTestInstance) {
  return root.findAllByType(TextInput).length > 0;
}

// Opens the add sheet from the plus button, types the name and confirms it.
function addManualItem(root: ReactTestInstance, name: string) {
  press(root, 'button', 'Agregar a la lista');
  act(() => {
    root.findByType(TextInput).props.onChangeText(name);
  });
  act(() => {
    root.findByType(TextInput).props.onSubmitEditing();
  });
}

const EMPTY_LABEL = 'No hay nada para comprar';
const MANUAL_TITLE = 'Agregados a mano';
const MANUAL_HINT = 'Todavía no agregaste nada.';

// The `immediateKey` of every style that has one, in render order: the rows and checkboxes.
function getImmediateKeys() {
  return jest
    .mocked(useAnimatedThemeStyle)
    .mock.calls.flatMap(([, options]) => (options ? [options.immediateKey] : []));
}

beforeEach(() => {
  jest.mocked(useAnimatedThemeStyle).mockClear();
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
      MANUAL_TITLE,
      MANUAL_HINT,
    ]);
  });

  it('shows the date as plain text: the buttons are the grouping options and the add one', () => {
    const root = renderScreen();

    expect(getPressables(root, 'button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Por categoría',
      'Por súper',
      'Agregar a la lista',
    ]);
  });

  it('marks the pressed row as purchased and updates the counter', () => {
    const root = renderScreen();

    press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');

    expect(getTexts(root)).toContain('3 ítems · 1 comprado');
    expect(
      getPressables(root, 'checkbox')
        .filter((checkbox) => checkbox.props.accessibilityState.checked)
        .map((checkbox) => checkbox.props.accessibilityLabel)
    ).toEqual(['2 u · Tomate, Coto · $1.100']);
  });

  it('applies the purchased look of the pressed row at once, and of no other row', () => {
    const root = renderScreen();
    const before = getImmediateKeys();
    jest.mocked(useAnimatedThemeStyle).mockClear();

    press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
    const after = getImmediateKeys();

    // Two group checkboxes and three rows of two lines and a checkbox each.
    expect(before).toHaveLength(11);
    expect(after).toHaveLength(11);
    // Only the name, the meta and the checkbox of the pressed row change their key.
    expect(after.filter((key, index) => key !== before[index])).toHaveLength(3);
  });

  it('marks a whole group from its "Marcar todos"', () => {
    const root = renderScreen();

    press(root, 'checkbox', 'Marcar todos, Verduras');

    expect(getTexts(root)).toContain('3 ítems · 2 comprados');
    expect(
      getPressables(root, 'checkbox')
        .filter((checkbox) => checkbox.props.accessibilityState.checked)
        .map((checkbox) => checkbox.props.accessibilityLabel)
    ).toEqual([
      'Marcar todos, Verduras',
      '100 g · Espinaca, Sin precio',
      '2 u · Tomate, Coto · $1.100',
    ]);
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

  it('says there is nothing to buy, with no date, above the manual card when the plan is empty', () => {
    useMealPlanStore.setState({ entries: [] });

    const root = renderScreen();

    expect(getTexts(root)).toEqual([
      'Por categoría',
      'Por súper',
      'COMPRAS',
      '0 ítems · 0 comprados',
      EMPTY_LABEL,
      MANUAL_TITLE,
      MANUAL_HINT,
    ]);
  });

  it('does not say the list is empty while a manual item is on it', () => {
    useMealPlanStore.setState({ entries: [] });
    useShoppingListStore.setState({
      manualItems: [{ id: 'manual:1', source: 'manual', status: 'needed', name: 'Velas' }],
    });

    const root = renderScreen();

    expect(getTexts(root)).toEqual([
      'Por categoría',
      'Por súper',
      'COMPRAS',
      '1 ítem · 0 comprados',
      MANUAL_TITLE,
      'Velas',
      'Sin precio',
    ]);
  });

  it('does not say the list is empty while the plan has rows and nothing was added by hand', () => {
    const root = renderScreen();

    expect(getTexts(root)).not.toContain(EMPTY_LABEL);
    expect(getTexts(root)).toContain(MANUAL_HINT);
  });

  it.each([
    ['category', 'Proteínas'],
    ['supermarket', 'Sin súper'],
  ] as const)('keeps the manual card after the %s cards', (groupingMode, lastGroupTitle) => {
    useShoppingListStore.setState({
      groupingMode,
      manualItems: [{ id: 'manual:1', source: 'manual', status: 'needed', name: 'Velas' }],
    });

    const root = renderScreen();
    const texts = getTexts(root);

    expect(texts.indexOf(MANUAL_TITLE)).toBeGreaterThan(texts.indexOf(lastGroupTitle));
    expect(texts.slice(texts.indexOf(MANUAL_TITLE))).toEqual([MANUAL_TITLE, 'Velas', 'Sin precio']);
  });

  describe('adding by hand', () => {
    it('opens the add sheet from the plus button of the manual card', () => {
      const root = renderScreen();

      expect(isAddSheetOpen(root)).toBe(false);

      press(root, 'button', 'Agregar a la lista');

      expect(isAddSheetOpen(root)).toBe(true);
      expect(getTexts(root)).toContain('¿Qué querés agregar?');
    });

    it('lists the confirmed name in the manual card, counts it and closes the sheet', () => {
      const root = renderScreen();

      addManualItem(root, ' Papel de cocina ');

      const texts = getTexts(root);
      expect(texts.slice(texts.indexOf(MANUAL_TITLE))).toEqual([
        MANUAL_TITLE,
        'Papel de cocina',
        'Sin precio',
      ]);
      expect(texts).toContain('4 ítems · 0 comprados');
      expect(isAddSheetOpen(root)).toBe(false);
    });

    it('closes the sheet from "Cancelar" without adding', () => {
      const root = renderScreen();
      press(root, 'button', 'Agregar a la lista');

      act(() => {
        getPressables(root, 'button')
          .find((button) => getTexts(button).includes('Cancelar'))!
          .props.onPress();
      });

      expect(isAddSheetOpen(root)).toBe(false);
      expect(getTexts(root)).toContain(MANUAL_HINT);
    });

    it('toggles a manual row like any other', () => {
      const root = renderScreen();
      addManualItem(root, 'Velas');

      press(root, 'checkbox', 'Velas, Sin precio');

      expect(getTexts(root)).toContain('4 ítems · 1 comprado');
    });
  });

  describe('removing and restoring', () => {
    const restoreLabels = (root: ReactTestInstance) =>
      getTexts(root).filter((text) => text.includes('Restaurar'));

    it('has no restore line while nothing was removed', () => {
      const root = renderScreen();

      expect(restoreLabels(root)).toEqual([]);
    });

    it('takes a long-pressed planned row off the list and offers to restore it', () => {
      const root = renderScreen();

      longPress(root, '2 u · Tomate, Coto · $1.100');

      expect(getTexts(root)).not.toContain('2 u · Tomate');
      expect(getTexts(root)).toContain('2 ítems · 0 comprados');
      expect(restoreLabels(root)).toEqual(['1 quitado · Restaurar']);
      // The line is the last thing on the list, under the manual card.
      expect(getTexts(root).at(-1)).toBe('1 quitado · Restaurar');
    });

    it('counts a removed manual row too, in the plural', () => {
      const root = renderScreen();
      addManualItem(root, 'Velas');
      longPress(root, '2 u · Tomate, Coto · $1.100');

      longPress(root, 'Velas, Sin precio');

      expect(getTexts(root)).toContain(MANUAL_HINT);
      expect(restoreLabels(root)).toEqual(['2 quitados · Restaurar']);
    });

    it('brings the removed rows back from the restore line, which then goes away', () => {
      const root = renderScreen();
      addManualItem(root, 'Velas');
      longPress(root, '2 u · Tomate, Coto · $1.100');
      longPress(root, 'Velas, Sin precio');

      press(root, 'button', '2 quitados · Restaurar');

      expect(getTexts(root)).toEqual(expect.arrayContaining(['2 u · Tomate', 'Velas']));
      expect(getTexts(root)).toContain('4 ítems · 0 comprados');
      expect(restoreLabels(root)).toEqual([]);
    });

    it('says the list is empty once every row was removed, and still offers to restore', () => {
      useMealPlanStore.setState({ entries: [PLAN[1]] });
      const root = renderScreen();

      longPress(root, '100 g · Espinaca, Sin precio');

      const texts = getTexts(root);
      expect(texts.slice(texts.indexOf('COMPRAS'))).toEqual([
        'COMPRAS',
        '0 ítems · 0 comprados',
        EMPTY_LABEL,
        MANUAL_TITLE,
        MANUAL_HINT,
        '1 quitado · Restaurar',
      ]);
    });
  });
});
