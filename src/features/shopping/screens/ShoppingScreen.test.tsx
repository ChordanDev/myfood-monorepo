/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { MasterRecipe, MealPlanEntry } from '@/types/domain';
import type { FloatingCalendarProps } from '@/features/home';
import { useInventoryStore } from '@/features/inventory/store';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { useMealPlanStore } from '@/store';
import { useShoppingListStore } from '../store';
import { ShoppingScreen } from './ShoppingScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

// The day the list takes for today: before both planned meals.
jest.mock('../store/today', () => ({ getTodayKey: () => '2026-10-01' }));

const mockFloatingCalendars: FloatingCalendarProps[] = [];
const mockAnchor = { x: 14, y: 60, width: 150, height: 42 };

// The calendar is the Home feature's, whose barrel this suite's reanimated mock cannot
// evaluate: the screen is tested for what the pill hands it. The anchor opens with a fixed
// frame, since a Jest view measures nothing.
jest.mock('@/features/home', () => {
  const { useState } = require('react');

  return {
    FloatingCalendar: (props: FloatingCalendarProps) => {
      mockFloatingCalendars.push(props);
      return null;
    },
    useFloatingCalendarAnchor: () => {
      const [anchor, setAnchor] = useState(null);

      return {
        anchorRef: { current: null },
        anchor,
        open: () => setAnchor(mockAnchor),
        close: () => setAnchor(null),
      };
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return {
    __esModule: true,
    default: { Text, View },
    cancelAnimation: jest.fn(),
    Easing: { linear: 'linear', out: (curve: unknown) => curve, quad: 'quad' },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');

  return {
    LinearGradient: ({ style }: { style: object }) => <View style={style} />,
  };
});

// iOS keeps the children of a modal mounted while it fades out; the stock Jest mock drops
// them at once. A test turns this on to press what is still on screen during that fade.
let mockKeepsChildrenWhileHidden = false;

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible || mockKeepsChildrenWhileHidden ? children : null,
}));

// Only what the screen uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: jest.requireActual('@/components/SafeAreaContent').SafeAreaContent,
  SegmentedSwitcher: jest.requireActual('@/components/SegmentedSwitcher').SegmentedSwitcher,
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('lucide-react-native', () => ({
  Calendar: 'Calendar',
  Check: 'Check',
  Plus: 'Plus',
  ShoppingCart: 'ShoppingCart',
  X: 'X',
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
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

// The badge of the cart button holds a number: every text is read as a string.
function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => String(node.props.children));
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

// Presses a button by the text it shows: the actions of a sheet have no label of their own.
function pressText(root: ReactTestInstance, text: string) {
  const target = getPressables(root, 'button').find((button) => getTexts(button).includes(text));

  if (!target) {
    throw new Error(`No button showing "${text}"`);
  }

  act(() => {
    target.props.onPress();
  });
}

const CART_TITLE = 'Tu carrito';
const CART_EMPTY_HINT = 'Todavía no marcaste nada.';
const CONFIRM = 'Marcar como comprado';

function isCartSheetOpen(root: ReactTestInstance) {
  return getTexts(root).includes(CART_TITLE);
}

// What the cart sheet shows, from its title to its last action.
function getCartSheetTexts(root: ReactTestInstance) {
  const texts = getTexts(root);

  return texts.slice(texts.indexOf(CART_TITLE), texts.indexOf('Cancelar') + 1);
}

function getCheckedLabels(root: ReactTestInstance) {
  return getPressables(root, 'checkbox')
    .filter((checkbox) => checkbox.props.accessibilityState.checked)
    .map((checkbox) => checkbox.props.accessibilityLabel);
}

function stockOf(ingredientId: string) {
  return useInventoryStore.getState().items.find((item) => item.ingredientId === ingredientId)
    ?.quantity;
}

const UNTIL_THE_12TH = 'Elegir hasta qué día comprar, ahora 12 Oct';

// What the date pill hands the floating calendar on its last render.
function untilCalendar() {
  return mockFloatingCalendars[mockFloatingCalendars.length - 1];
}

function pickUntilDate(dateKey: string) {
  act(() => {
    untilCalendar().onSelectDate?.(dateKey);
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
  mockKeepsChildrenWhileHidden = false;
  mockFloatingCalendars.length = 0;
  jest.mocked(useAnimatedThemeStyle).mockClear();
  useMealPlanStore.setState({
    entries: PLAN,
    recipes: RECIPES as MasterRecipe[],
  });
  useInventoryStore.setState({ items: [], ingredients: MOCK_INGREDIENTS });
  useShoppingListStore.setState({
    cartIds: [],
    removedIds: [],
    manualItems: [],
    lastManualItemSequence: 0,
    groupingMode: 'category',
    chosenUntilDate: undefined,
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
      '3 ítems · 0 en el carrito',
      'Verduras',
      'Marcar todos',
      '100 g · Espinaca',
      'Sin precio',
      '2 u · Tomate',
      'Coto · $1.100',
      'Carnes',
      'Marcar todos',
      '200 g · Pollo (Pechuga)',
      'Día · $1.520',
      MANUAL_TITLE,
      MANUAL_HINT,
    ]);
  });

  it('shows the date as a button, before the grouping options, the add one and the cart', () => {
    const root = renderScreen();

    expect(getPressables(root, 'button').map((button) => button.props.accessibilityLabel)).toEqual([
      UNTIL_THE_12TH,
      'Por categoría',
      'Por súper',
      'Agregar a la lista',
      'Ver carrito, vacío',
    ]);
  });

  it('puts the pressed row in the cart, counts it and leaves the inventory alone', () => {
    const root = renderScreen();

    press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');

    expect(getTexts(root)).toContain('3 ítems · 1 en el carrito');
    expect(getCheckedLabels(root)).toEqual(['2 u · Tomate, Coto · $1.100']);
    expect(useInventoryStore.getState().items).toEqual([]);
  });

  it('takes the row back out of the cart when it is pressed again', () => {
    const root = renderScreen();
    press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');

    press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');

    expect(getTexts(root)).toContain('3 ítems · 0 en el carrito');
    expect(getCheckedLabels(root)).toEqual([]);
  });

  it('applies the in-cart look of the pressed row at once, and of no other row', () => {
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

  it('puts a whole group in the cart from its "Marcar todos", and takes it out again', () => {
    const root = renderScreen();

    press(root, 'checkbox', 'Marcar todos, Verduras');

    expect(getTexts(root)).toContain('3 ítems · 2 en el carrito');
    expect(getCheckedLabels(root)).toEqual([
      'Marcar todos, Verduras',
      '100 g · Espinaca, Sin precio',
      '2 u · Tomate, Coto · $1.100',
    ]);
    expect(useInventoryStore.getState().items).toEqual([]);

    press(root, 'checkbox', 'Marcar todos, Verduras');

    expect(getTexts(root)).toContain('3 ítems · 0 en el carrito');
    expect(getCheckedLabels(root)).toEqual([]);
  });

  it('regroups by supermarket from the switcher', () => {
    const root = renderScreen();

    press(root, 'button', 'Por súper');

    const titles = ['Coto', 'Día', 'Sin súper'];
    expect(getTexts(root).filter((text) => titles.includes(text))).toEqual(titles);
    expect(getTexts(root)).not.toContain('Verduras');
  });

  it('clears the tab bar and the cart button itself, without letting iOS add the safe area again', () => {
    const root = renderScreen();
    const list = root.findByType(ScrollView);

    expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
    // Tab bar, a gap, the 56 pt button and a gap: the last checkbox scrolls clear of it.
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(
      34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + 14 + 56 + 14
    );
  });

  describe('the date pill', () => {
    it('opens a calendar under itself that offers the planned days from today on', () => {
      const root = renderScreen();

      expect(untilCalendar().anchor).toBeNull();

      press(root, 'button', UNTIL_THE_12TH);

      const { anchor, isDateSelectable, monthBounds, planByDate, selectedDate } = untilCalendar();
      expect(anchor).toEqual(mockAnchor);
      expect(selectedDate).toBe('2026-10-12');
      expect(isDateSelectable?.('2026-10-06')).toBe(true);
      expect(isDateSelectable?.('2026-10-12')).toBe(true);
      expect(isDateSelectable?.('2026-10-08')).toBe(false);
      expect(monthBounds).toEqual({ months: ['2026-10'] });
      expect(Object.keys(planByDate ?? {})).toEqual(['2026-10-06', '2026-10-12']);
    });

    it('makes the pill, the cards and the counter reach the picked day, and closes the calendar', () => {
      const root = renderScreen();
      press(root, 'button', UNTIL_THE_12TH);

      pickUntilDate('2026-10-06');

      expect(getTexts(root)).toEqual([
        'Hasta 6 Oct',
        'Por categoría',
        'Por súper',
        'COMPRAS',
        '2 ítems · 0 en el carrito',
        'Verduras',
        'Marcar todos',
        '2 u · Tomate',
        'Coto · $1.100',
        'Carnes',
        'Marcar todos',
        '200 g · Pollo (Pechuga)',
        'Día · $1.520',
        MANUAL_TITLE,
        MANUAL_HINT,
      ]);
      expect(untilCalendar().anchor).toBeNull();
      expect(untilCalendar().selectedDate).toBe('2026-10-06');
    });

    it('reaches the last planned day again when it is picked back', () => {
      const root = renderScreen();
      press(root, 'button', UNTIL_THE_12TH);
      pickUntilDate('2026-10-06');

      press(root, 'button', 'Elegir hasta qué día comprar, ahora 6 Oct');
      pickUntilDate('2026-10-12');

      expect(getTexts(root)).toContain('Hasta 12 Oct');
      expect(getTexts(root)).toContain('3 ítems · 0 en el carrito');
    });

    it('closes on a tap outside and leaves the list as it was', () => {
      const root = renderScreen();
      const textsBefore = getTexts(root);
      press(root, 'button', UNTIL_THE_12TH);

      act(() => {
        untilCalendar().onClose();
      });

      expect(untilCalendar().anchor).toBeNull();
      expect(getTexts(root)).toEqual(textsBefore);
      expect(useShoppingListStore.getState().chosenUntilDate).toBeUndefined();
    });

    it('takes a row the picked day leaves out off the cart button and the cart sheet', () => {
      const root = renderScreen();
      press(root, 'checkbox', '100 g · Espinaca, Sin precio');
      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      press(root, 'button', UNTIL_THE_12TH);

      pickUntilDate('2026-10-06');

      expect(getTexts(root)).toContain('2 ítems · 1 en el carrito');

      press(root, 'button', 'Ver carrito, 1 ítem');

      expect(getCartSheetTexts(root)).not.toContain('100 g · Espinaca');
      expect(getCartSheetTexts(root)).toContain('2 u · Tomate');

      pressText(root, CONFIRM);

      expect(stockOf('i3')).toBe(2);
      expect(stockOf('i7')).toBeUndefined();
    });

    // Today is the 1st: a plan that ended in September has no day left to pick.
    it('only shows the date, and opens nothing, when every planned meal is in the past', () => {
      useMealPlanStore.setState({
        entries: [
          { id: 'mp0', date: '2026-09-28', type: 'almuerzo', recipeId: 'r1', isCooked: false },
        ],
      });

      const root = renderScreen();

      expect(getTexts(root)).toContain('Hasta 28 Sep');
      expect(getTexts(root)).toContain('2 ítems · 0 en el carrito');
      expect(
        getPressables(root, 'button').map((button) => button.props.accessibilityLabel)
      ).toEqual(['Por categoría', 'Por súper', 'Agregar a la lista', 'Ver carrito, vacío']);
      expect(mockFloatingCalendars).toHaveLength(0);
    });

    it('is not shown while the plan is empty', () => {
      useMealPlanStore.setState({ entries: [] });

      const root = renderScreen();

      expect(
        getPressables(root, 'button').map((button) => button.props.accessibilityLabel)
      ).toEqual(['Por categoría', 'Por súper', 'Agregar a la lista', 'Ver carrito, vacío']);
      expect(mockFloatingCalendars).toHaveLength(0);
    });
  });

  describe('the floating cart button', () => {
    function getCartButtonLabel(root: ReactTestInstance) {
      return getPressables(root, 'button')
        .map((button) => button.props.accessibilityLabel as string | undefined)
        .find((label) => label?.startsWith('Ver carrito'));
    }

    it('floats at the bottom right, above the tab bar, without blocking the list', () => {
      const root = renderScreen();
      const [holder] = root
        .findAllByType(View)
        .filter((view) => view.props.testID === 'shopping-cart-button');

      expect(StyleSheet.flatten(holder.props.style)).toEqual({
        bottom: 34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + 14,
        position: 'absolute',
        right: 14,
      });
      expect(holder.props.pointerEvents).toBe('box-none');
    });

    it('is there with an empty cart and with an empty list', () => {
      useMealPlanStore.setState({ entries: [] });

      const root = renderScreen();

      expect(getCartButtonLabel(root)).toBe('Ver carrito, vacío');
    });

    it('counts the rows in the cart, planned and manual, in its label and in its badge', () => {
      const root = renderScreen();
      addManualItem(root, 'Velas');

      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      expect(getCartButtonLabel(root)).toBe('Ver carrito, 1 ítem');
      expect(getTexts(root).at(-1)).toBe('1');

      press(root, 'checkbox', 'Velas, Sin precio');
      expect(getCartButtonLabel(root)).toBe('Ver carrito, 2 ítems');
      expect(getTexts(root).at(-1)).toBe('2');

      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      press(root, 'checkbox', 'Velas, Sin precio');
      expect(getCartButtonLabel(root)).toBe('Ver carrito, vacío');
      // No badge again: the last text on screen is the meta line of the manual row.
      expect(getTexts(root).at(-1)).toBe('Sin precio');
    });
  });

  describe('the cart sheet', () => {
    it('opens from the floating button with the rows that were marked', () => {
      const root = renderScreen();
      addManualItem(root, 'Velas');
      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      press(root, 'checkbox', 'Velas, Sin precio');
      expect(isCartSheetOpen(root)).toBe(false);

      press(root, 'button', 'Ver carrito, 2 ítems');

      expect(getCartSheetTexts(root)).toEqual([
        CART_TITLE,
        '2 u · Tomate',
        'Coto · $1.100',
        'Velas',
        'Sin precio',
        CONFIRM,
        'Cancelar',
      ]);
    });

    it('opens on a hint, with nothing to confirm, while the cart is empty', () => {
      const root = renderScreen();

      press(root, 'button', 'Ver carrito, vacío');

      expect(getCartSheetTexts(root)).toEqual([CART_TITLE, CART_EMPTY_HINT, CONFIRM, 'Cancelar']);
    });

    it('buys the cart on "Marcar como comprado": the sheet closes and the rows are gone', () => {
      const root = renderScreen();
      addManualItem(root, 'Velas');
      addManualItem(root, 'Hielo');
      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      press(root, 'checkbox', 'Velas, Sin precio');
      press(root, 'button', 'Ver carrito, 2 ítems');

      pressText(root, CONFIRM);

      expect(isCartSheetOpen(root)).toBe(false);
      expect(stockOf('i3')).toBe(2);
      expect(stockOf('i2')).toBeUndefined();
      const texts = getTexts(root);
      expect(texts).not.toContain('2 u · Tomate');
      expect(texts).not.toContain('Velas');
      expect(texts).toContain('3 ítems · 0 en el carrito');
      expect(texts.slice(texts.indexOf(MANUAL_TITLE))).toEqual([
        MANUAL_TITLE,
        'Hielo',
        'Sin precio',
      ]);
      expect(getCheckedLabels(root)).toEqual([]);
      expect(useShoppingListStore.getState().manualItems.map((item) => item.name)).toEqual([
        'Hielo',
      ]);
    });

    it('buys once when "Marcar como comprado" is pressed again while the sheet fades out', () => {
      mockKeepsChildrenWhileHidden = true;
      const root = renderScreen();
      press(root, 'checkbox', '200 g · Pollo (Pechuga), Día · $1.520');
      press(root, 'button', 'Ver carrito, 1 ítem');
      pressText(root, CONFIRM);

      // A row marked behind the closing sheet must not be bought by the late press.
      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      pressText(root, CONFIRM);

      expect(stockOf('i2')).toBe(200);
      expect(stockOf('i3')).toBeUndefined();
      expect(getTexts(root)).toContain('2 ítems · 1 en el carrito');
    });

    it('takes a single row out of the cart from the sheet, and leaves it on the list', () => {
      const root = renderScreen();
      press(root, 'checkbox', 'Marcar todos, Verduras');
      press(root, 'button', 'Ver carrito, 2 ítems');

      press(root, 'button', 'Sacar del carrito, 2 u · Tomate');

      expect(getCartSheetTexts(root)).toEqual([
        CART_TITLE,
        '100 g · Espinaca',
        'Sin precio',
        CONFIRM,
        'Cancelar',
      ]);
      expect(getCheckedLabels(root)).toEqual(['100 g · Espinaca, Sin precio']);
      expect(getTexts(root)).toContain('3 ítems · 1 en el carrito');
      expect(useInventoryStore.getState().items).toEqual([]);
    });

    it.each(['Cancelar', 'Cerrar'])('closes from "%s" without buying anything', (name) => {
      const root = renderScreen();
      press(root, 'checkbox', '2 u · Tomate, Coto · $1.100');
      press(root, 'button', 'Ver carrito, 1 ítem');

      if (name === 'Cerrar') press(root, 'button', name);
      else pressText(root, name);

      expect(isCartSheetOpen(root)).toBe(false);
      expect(useInventoryStore.getState().items).toEqual([]);
      expect(getTexts(root)).toContain('3 ítems · 1 en el carrito');
      expect(getCheckedLabels(root)).toEqual(['2 u · Tomate, Coto · $1.100']);
    });
  });

  it('says there is nothing to buy, with no date, above the manual card when the plan is empty', () => {
    useMealPlanStore.setState({ entries: [] });

    const root = renderScreen();

    expect(getTexts(root)).toEqual([
      'Por categoría',
      'Por súper',
      'COMPRAS',
      '0 ítems · 0 en el carrito',
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
      '1 ítem · 0 en el carrito',
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
    ['category', 'Carnes'],
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
      expect(texts).toContain('4 ítems · 0 en el carrito');
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

      expect(getTexts(root)).toContain('4 ítems · 1 en el carrito');
      expect(getCheckedLabels(root)).toEqual(['Velas, Sin precio']);
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
      expect(getTexts(root)).toContain('2 ítems · 0 en el carrito');
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
      expect(getTexts(root)).toContain('4 ítems · 0 en el carrito');
      expect(restoreLabels(root)).toEqual([]);
    });

    it('says the list is empty once every row was removed, and still offers to restore', () => {
      useMealPlanStore.setState({ entries: [PLAN[1]] });
      const root = renderScreen();

      longPress(root, '100 g · Espinaca, Sin precio');

      const texts = getTexts(root);
      expect(texts.slice(texts.indexOf('COMPRAS'))).toEqual([
        'COMPRAS',
        '0 ítems · 0 en el carrito',
        EMPTY_LABEL,
        MANUAL_TITLE,
        MANUAL_HINT,
        '1 quitado · Restaurar',
      ]);
    });
  });
});
