/* eslint-disable @typescript-eslint/no-require-imports */
/// <reference types="node" />

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { Check } from 'lucide-react-native';
import type { FloatingCalendarProps } from '@/features/home';
import { useInventoryStore } from '@/features/inventory/store';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { useMealPlanStore } from '@/store';
import {
  CART_SESSION_ID,
  EMPTY_SHOPPING_LIST,
  MANUAL_DISH_SOAP,
  MILK_LINE_ID,
  OLIVE_OIL_LINE_ID,
  RICE_LINE_ID,
  RICE_NEEDED_ITEM_IDS,
  SHOPPING_LIST_AFTER_PURCHASE,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE,
  SHOPPING_LIST_WITH_CART_OUT_OF_RANGE,
  SHOPPING_LIST_VALIDATION_ERROR,
  SHOPPING_LIST_WITH_MANUAL_AND_REMOVED,
  TOMATO_ITEM_IDS,
  toCheckoutResponse,
  toDeleteItemResponse,
  toManualItemResponse,
  toSetStatusResponse,
  toShoppingErrorResponse,
  toShoppingListResponse,
} from '../fixtures';
import { useShoppingListStore } from '../store';
import type { ShoppingListRead } from '../types';
import { ShoppingScreen } from './ShoppingScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

// Who is signed in. The barrel of the auth feature holds its screens, which this suite cannot
// load, and the screen only asks it for the user: the hook is replaced by that answer.
let mockUser: { id: string } | null = null;

jest.mock('@/features/auth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

// What the screen does when it comes into focus. The mock runs it on mount, as the router
// does for the screen it opens on, and a test runs it again to come back to the screen.
let mockFocusEffect: (() => void) | undefined;
// A test turns this off to see the screen as it is drawn before it has asked for anything.
let mockIsFocused = true;

jest.mock('expo-router', () => {
  const { useEffect, useRef } = require('react');

  // The screen has more than one such effect: the read of the list and the Cart lease. Coming
  // back to the screen runs each one's latest effect.
  const latestEffects = new Set<{ current: () => void | (() => void) }>();

  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      const latest = useRef(effect);
      latest.current = effect;

      useEffect(() => {
        latestEffects.add(latest);
        mockFocusEffect = () => latestEffects.forEach((registered) => registered.current());
        const cleanup = mockIsFocused ? effect() : undefined;

        return () => {
          latestEffects.delete(latest);
          cleanup?.();
        };
      }, [effect]);
    },
  };
});

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

// The barrel of the components also holds the ones that are off the screen for now: the cart
// button and the two sheets. These are what they need to be loaded.
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');

  return {
    LinearGradient: ({ style }: { style: object }) => <View style={style} />,
  };
});

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: false }),
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

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eeeeee',
      colorBlack: '#000000',
      colorDark: '#111111',
      colorLight: '#999999',
      colorMedium: '#444444',
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

const LIST_URL = 'https://api.example.test/api/shopping-list';

const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 422) {
  return { ok, status, text: () => Promise.resolve(JSON.stringify(payload)) } as Response;
}

function listResponse(read: ShoppingListRead) {
  return jsonResponse(toShoppingListResponse(read));
}

// What the server answers for the plan of the fixtures, by the filters of the request.
function readFor(url: string): ShoppingListRead {
  if (url.includes('groupBy=meal')) return SHOPPING_LIST_BY_MEAL;
  if (url.includes('untilDate=2026-10-10')) return SHOPPING_LIST_UNTIL_OCT_10;
  return SHOPPING_LIST_BY_INGREDIENT;
}

function serveThePlan() {
  fetchMock.mockImplementation((url: string) => Promise.resolve(listResponse(readFor(url))));
}

// Answers the next request with this read, whatever it asks for.
function answerOnceWith(read: ShoppingListRead) {
  fetchMock.mockResolvedValueOnce(listResponse(read));
}

// The server cannot be reached: the transport asks twice before it gives up.
function failTheNetworkOnce() {
  fetchMock
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockRejectedValueOnce(new TypeError('Network request failed'));
}

// A request the test answers when it chooses to.
function holdTheNextRequest() {
  let answer: (read: ShoppingListRead) => void = () => {};

  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      answer = (read) => resolve(listResponse(read));
    })
  );

  return { answer: (read: ShoppingListRead) => answer(read) };
}

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url as string);

let tree: ReturnType<typeof create> | undefined;

// Lets the reads that were asked for go out, and their answers land on the screen.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The screen as it is first drawn, with its first read still on its way.
function renderScreen(): ReactTestInstance {
  act(() => {
    tree = create(<ShoppingScreen />);
  });

  return tree!.root;
}

// The screen once its first read has landed.
async function renderLoadedScreen(): Promise<ReactTestInstance> {
  const root = renderScreen();
  await settle();

  return root;
}

// Leaves the tab and comes back to it.
async function focusScreen() {
  act(() => {
    mockFocusEffect?.();
  });
  await settle();
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => String(node.props.children));
}

function getButtons(root: ReactTestInstance) {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );
}

function getCheckboxes(root: ReactTestInstance) {
  return root.findAll(
    (node) =>
      node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function'
  );
}

function getButtonLabels(root: ReactTestInstance): string[] {
  return getButtons(root).map((button) => button.props.accessibilityLabel);
}

async function press(root: ReactTestInstance, label: string) {
  const target = getButtons(root).find((button) => button.props.accessibilityLabel === label);

  if (!target) {
    throw new Error(`No button labelled "${label}"`);
  }

  act(() => {
    target.props.onPress();
  });
  await settle();
}

// Presses a button by the text it shows.
async function pressText(root: ReactTestInstance, text: string) {
  const target = getButtons(root).find((button) => getTexts(button).includes(text));

  if (!target) {
    throw new Error(`No button showing "${text}"`);
  }

  act(() => {
    target.props.onPress();
  });
  await settle();
}

function getIndicators(root: ReactTestInstance, label: string) {
  return root
    .findAllByType(ActivityIndicator)
    .filter((indicator) => indicator.props.accessibilityLabel === label);
}

// The first read is on its way: there is no list to show yet.
function isLoading(root: ReactTestInstance) {
  return getIndicators(root, 'Cargando la lista de compras').length > 0;
}

// A read is on its way over the list on screen.
function isReadingAgain(root: ReactTestInstance) {
  return getIndicators(root, READING_AGAIN).length > 0;
}

// The first line of every row that is struck through: the ones shown as in the cart.
function getStruckNames(root: ReactTestInstance): string[] {
  return root
    .findAllByType(Text)
    .filter((node) => StyleSheet.flatten(node.props.style).textDecorationLine === 'line-through')
    .map((node) => String(node.props.children));
}

// What the date pill hands the floating calendar on its last render.
function untilCalendar() {
  return mockFloatingCalendars[mockFloatingCalendars.length - 1];
}

async function pickUntilDate(dateKey: string) {
  act(() => {
    untilCalendar().onSelectDate?.(dateKey);
  });
  await settle();
}

const UNTIL_THE_12TH = 'Elegir hasta qué día comprar, ahora 12 Oct';
const EMPTY_LABEL = 'No hay nada para comprar';
const NETWORK_ERROR = 'No pudimos conectar con el servidor. Revisá tu conexión.';
const RETRY = 'Reintentar';
const READING_AGAIN = 'Actualizando la lista de compras';
const ADD_LABEL = 'Agregar a la lista';

// The card of the items added by hand: on screen once a list was read, empty or not.
const MANUAL_CARD = ['Agregados a mano', 'Todavía no agregaste nada.'];

// The badge of the cart button, drawn over the list: the Cart of the plan holds two lines.
const CART_BADGE = '2';
const CART_BUTTON_LABEL = 'Ver carrito, 2 ítems';

const HEADER = ['Hasta 12 Oct', 'Por ingrediente', 'Por comida', 'COMPRAS'];

// The cards of the plan read per ingredient: each card a category, each row its lines.
const CARDS_BY_INGREDIENT = [
  'Verduras',
  '5 u · Tomate',
  'Para 2 comidas',
  'Frutas',
  '2 u · Banana',
  'Carnes',
  '1,1 kg · Pollo',
  'Para 2 comidas',
  'Lácteos',
  '1,25 L · Leche',
  'Para 2 comidas',
  'Granos',
  '1,25 kg · Arroz',
  'Para 3 comidas',
  'No perecederos',
  '30 ml · Aceite de oliva',
  ...MANUAL_CARD,
  CART_BADGE,
];

const USER_A = { id: 'user-a' };
const USER_B = { id: 'user-b' };

// Another user signs in on the same device: the screen is drawn again for them.
function signInAs(user: { id: string } | null) {
  mockUser = user;
  act(() => {
    tree?.update(<ShoppingScreen />);
  });
}

beforeEach(async () => {
  mockUser = USER_A;
  mockIsFocused = true;
  mockFocusEffect = undefined;
  mockFloatingCalendars.length = 0;
  mockSecureStore.clear();
  mockSecureStore.set('auth_access_token', 'access-1');
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  useShoppingListStore.setState(useShoppingListStore.getInitialState(), true);
  serveThePlan();
});

afterEach(async () => {
  act(() => tree?.unmount());
  tree = undefined;
  // No answer of this test is left to land on the next one.
  await settle();
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

describe('ShoppingScreen', () => {
  describe('the first read', () => {
    it('asks the server for the list as soon as the screen is shown', async () => {
      await renderLoadedScreen();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `${LIST_URL}?groupBy=ingredient`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        })
      );
    });

    it('shows that it is loading, with no date, counter or card, until the read lands', async () => {
      const request = holdTheNextRequest();
      const root = renderScreen();
      await settle();

      expect(isLoading(root)).toBe(true);
      expect(getTexts(root)).toEqual(['Por ingrediente', 'Por comida', 'COMPRAS']);

      request.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();

      expect(isLoading(root)).toBe(false);
      expect(getTexts(root)).toContain('Verduras');
    });

    it('lists the read by category under the date, the switcher, the title and the counter', async () => {
      const root = await renderLoadedScreen();

      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });

    it('takes the counter from the totals of the read, not from its rows', async () => {
      fetchMock.mockReset();
      answerOnceWith({
        ...SHOPPING_LIST_BY_INGREDIENT,
        totals: { needed: 40, inCart: 2, removed: 0, estimatedCents: 0 },
      });

      const root = await renderLoadedScreen();

      expect(getTexts(root)).toContain('42 ítems · 2 en el carrito');
    });

    it('does not follow the meal plan or the inventory of the device', async () => {
      const root = await renderLoadedScreen();
      const textsBefore = getTexts(root);

      act(() => {
        useMealPlanStore.setState({ entries: [], recipes: [] });
        useInventoryStore.setState({ items: [], ingredients: [] });
      });
      await settle();

      expect(getTexts(root)).toEqual(textsBefore);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('a list with a tick', () => {
    it('lets a row be ticked or held to remove it, with no "Marcar todos"', async () => {
      const root = await renderLoadedScreen();
      const list = root.findByType(ScrollView);

      expect(getTexts(root)).not.toContain('Marcar todos');
      expect(getCheckboxes(root)).toHaveLength(6);
      // Every planned row can be held, and each one offers the removal to screen readers.
      expect(list.findAll((node) => typeof node.props.onLongPress === 'function')).toHaveLength(6);
    });

    it('offers the date, the two groupings, the abandoning of the Cart, the add and the cart to press', async () => {
      const root = await renderLoadedScreen();

      expect(getButtonLabels(root)).toEqual([
        UNTIL_THE_12TH,
        'Por ingrediente',
        'Por comida',
        'Cancelar carrito',
        ADD_LABEL,
        CART_BUTTON_LABEL,
      ]);
    });

    it('shows a line in the cart struck through and ticked, and the others as boxes to tick', async () => {
      const root = await renderLoadedScreen();

      expect(getStruckNames(root)).toEqual(['30 ml · Aceite de oliva']);
      expect(root.findAllByType(Check)).toHaveLength(1);
      expect(
        getCheckboxes(root).filter((row) => row.props.accessibilityState.checked)
      ).toHaveLength(1);
    });

    it('reads a line in the cart as a checked box to a screen reader', async () => {
      const root = await renderLoadedScreen();
      const rows = getCheckboxes(root).map((row) => [
        row.props.accessibilityLabel,
        row.props.accessibilityState.checked,
      ]);

      expect(rows).toContainEqual(['30 ml · Aceite de oliva', true]);
      expect(rows).toContainEqual(['1,25 kg · Arroz, Para 3 comidas', false]);
    });

    it('keeps the restore line off the screen while nothing is removed', async () => {
      const root = await renderLoadedScreen();

      expect(getTexts(root).some((text) => text.includes('Restaurar'))).toBe(false);
    });

    it('clears the tab bar, without letting iOS add the safe area again', async () => {
      const root = await renderLoadedScreen();
      const list = root.findByType(ScrollView);

      expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
      // The tab bar and a gap, then the cart button and another: the last card scrolls clear
      // of both.
      expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(
        34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + 14 + 56 + 14
      );
    });

    it('ends one gap above the tab bar while there is no Cart, and no cart button', async () => {
      fetchMock.mockReset();
      answerOnceWith({ ...SHOPPING_LIST_BY_INGREDIENT, cart: null });
      const root = await renderLoadedScreen();
      const list = root.findByType(ScrollView);

      expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(
        34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + 14
      );
    });
  });

  describe('shopping with a Cart lease', () => {
    // The shares of the rice that are still to buy: the one of the first meal is in the Cart.
    const RICE_ITEM_IDS = [
      '7eabbc7a-4d46-49a2-a44a-4a06b663d25f',
      '92d4f57b-380a-4fec-a6c7-d0b3e48fa1cf',
    ];
    const MARK_CART_URL = 'https://api.example.test/api/shopping-items/mark-cart';
    const CART_URL = 'https://api.example.test/api/cart/36d3abb6-dd68-4728-a33a-ab33b02ecdfe';

    function serveCartRoutes(markAnswer: Response) {
      fetchMock.mockImplementation((url: string) => {
        if (url === MARK_CART_URL) return Promise.resolve(markAnswer);
        if (url === CART_URL) {
          return Promise.resolve(
            jsonResponse({ data: { sessionId: 'x', updatedRows: 1, status: 'abandoned' } })
          );
        }
        return Promise.resolve(listResponse(readFor(url)));
      });
    }

    const markedCart = () =>
      jsonResponse({
        data: {
          sessionId: '36d3abb6-dd68-4728-a33a-ab33b02ecdfe',
          leaseExpiresAt: '2026-10-08T18:30:00Z',
          items: [],
        },
      });

    async function tick(root: ReactTestInstance, label: string) {
      const row = getCheckboxes(root).find((node) =>
        String(node.props.accessibilityLabel).includes(label)
      );
      if (!row) throw new Error(`No row labelled "${label}"`);

      act(() => {
        row.props.onPress();
      });
      await settle();
    }

    it('ticks the items behind a line that are still to buy into the Cart and reads the list again', async () => {
      serveCartRoutes(markedCart());
      const root = await renderLoadedScreen();

      await tick(root, 'Arroz');

      const markCall = fetchMock.mock.calls.find(([url]) => url === MARK_CART_URL);
      expect(JSON.parse(markCall![1].body)).toEqual({ itemIds: RICE_ITEM_IDS });
      expect(requestedUrls().filter((url) => url.startsWith(LIST_URL))).toHaveLength(2);
    });

    it('asks nothing for a line that is already in the Cart', async () => {
      serveCartRoutes(markedCart());
      const root = await renderLoadedScreen();

      await tick(root, 'Aceite de oliva');

      expect(requestedUrls()).not.toContain(MARK_CART_URL);
    });

    it('says the Cart is held by another member when the server answers `cart_locked`', async () => {
      serveCartRoutes(
        jsonResponse({ error: { code: 'cart_locked', message: 'held' } }, false, 409)
      );
      const root = await renderLoadedScreen();

      await tick(root, 'Arroz');

      expect(getTexts(root)).toContain(
        'Otro integrante del hogar ya tiene esos productos en su carrito.'
      );
    });

    it('says the Cart expired and reads the list again when the server answers `stale_cart`', async () => {
      serveCartRoutes(
        jsonResponse({ error: { code: 'stale_cart', message: 'expired' } }, false, 409)
      );
      const root = await renderLoadedScreen();

      await tick(root, 'Arroz');

      expect(getTexts(root)).toContain('Tu carrito venció. Volvé a marcar los productos.');
      expect(requestedUrls().filter((url) => url.startsWith(LIST_URL))).toHaveLength(2);
    });

    it('abandons the Cart and reads the list again', async () => {
      serveCartRoutes(markedCart());
      const root = await renderLoadedScreen();

      await press(root, 'Cancelar carrito');

      const cancelCall = fetchMock.mock.calls.find(([url]) => url === CART_URL);
      expect(cancelCall![1].method).toBe('DELETE');
      expect(requestedUrls().filter((url) => url.startsWith(LIST_URL))).toHaveLength(2);
    });
  });

  describe('the grouping', () => {
    it('starts per ingredient', async () => {
      const root = await renderLoadedScreen();
      const selected = getButtons(root)
        .filter((button) => button.props.accessibilityState?.selected)
        .map((button) => button.props.accessibilityLabel);

      expect(selected).toEqual(['Por ingrediente']);
    });

    it('asks for the lines per meal, and shows each one with its day and its slot', async () => {
      const root = await renderLoadedScreen();

      await press(root, 'Por comida');

      expect(requestedUrls()).toEqual([
        `${LIST_URL}?groupBy=ingredient`,
        `${LIST_URL}?groupBy=meal`,
      ]);
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '11 ítems · 2 en el carrito',
        'Verduras',
        '2 u · Tomate',
        '8 Oct · Almuerzo',
        '3 u · Tomate',
        '10 Oct · Cena',
        'Frutas',
        '2 u · Banana',
        '12 Oct · Desayuno',
        'Carnes',
        '600 g · Pollo',
        '8 Oct · Almuerzo',
        '500 g · Pollo',
        '12 Oct · Almuerzo',
        'Lácteos',
        '500 ml · Leche',
        '10 Oct · Cena',
        '750 ml · Leche',
        '12 Oct · Desayuno',
        'Granos',
        '400 g · Arroz',
        '8 Oct · Almuerzo',
        '400 g · Arroz',
        '10 Oct · Cena',
        '450 g · Arroz',
        '12 Oct · Almuerzo',
        'No perecederos',
        '30 ml · Aceite de oliva',
        '8 Oct · Almuerzo',
        ...MANUAL_CARD,
        CART_BADGE,
      ]);
    });

    it('shows the share of a meal that is in the cart as such, and not the rest of its ingredient', async () => {
      const root = await renderLoadedScreen();

      await press(root, 'Por comida');

      // The rice of the 8th is in the Cart; the rice of the other two meals is not.
      expect(getStruckNames(root)).toEqual(['400 g · Arroz', '30 ml · Aceite de oliva']);
    });

    it('goes back to one line per ingredient', async () => {
      const root = await renderLoadedScreen();
      await press(root, 'Por comida');

      await press(root, 'Por ingrediente');

      expect(requestedUrls()[2]).toBe(`${LIST_URL}?groupBy=ingredient`);
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });

    it('keeps the list of the other grouping on screen, shown as being read again, until the new one lands', async () => {
      const root = await renderLoadedScreen();
      const request = holdTheNextRequest();

      await press(root, 'Por comida');

      expect(isLoading(root)).toBe(false);
      expect(isReadingAgain(root)).toBe(true);
      // Still the lines per ingredient: the rice of three meals does not pass for one meal.
      expect(getTexts(root)).toEqual(expect.arrayContaining(['1,25 kg · Arroz', 'Para 3 comidas']));
      expect(getTexts(root)).not.toContain('400 g · Arroz');

      request.answer(SHOPPING_LIST_BY_MEAL);
      await settle();

      expect(isReadingAgain(root)).toBe(false);
      expect(getTexts(root)).toEqual(expect.arrayContaining(['400 g · Arroz', '450 g · Arroz']));
      expect(getTexts(root)).not.toContain('1,25 kg · Arroz');
    });
  });

  describe('the date pill', () => {
    it('opens a calendar under itself that offers exactly the planned dates of the read', async () => {
      const root = await renderLoadedScreen();

      expect(untilCalendar().anchor).toBeNull();

      await press(root, UNTIL_THE_12TH);

      const {
        anchor,
        isDateSelectable,
        markedDates,
        monthBounds,
        planByDate,
        rangeStart,
        rangeEnd,
      } = untilCalendar();
      expect(anchor).toEqual(mockAnchor);
      expect(markedDates).toEqual(['2026-10-08', '2026-10-10', '2026-10-12']);
      // No meal of the device is handed to the calendar: the days are the server's.
      expect(planByDate).toBeUndefined();
      for (const day of ['2026-10-08', '2026-10-10', '2026-10-12']) {
        expect(isDateSelectable?.(day)).toBe(true);
      }
      for (const day of ['2026-10-07', '2026-10-09', '2026-10-11', '2026-10-13']) {
        expect(isDateSelectable?.(day)).toBe(false);
      }
      expect(monthBounds).toEqual({ months: ['2026-10'] });
      // The stretch the list buys for: from the first planned day to the last one.
      expect(rangeStart).toBe('2026-10-08');
      expect(rangeEnd).toBe('2026-10-12');
    });

    it('asks for the list until the picked day, shows that read and closes the calendar', async () => {
      const root = await renderLoadedScreen();
      await press(root, UNTIL_THE_12TH);

      await pickUntilDate('2026-10-10');

      expect(requestedUrls()[1]).toBe(`${LIST_URL}?untilDate=2026-10-10&groupBy=ingredient`);
      expect(getTexts(root)).toEqual([
        'Hasta 10 Oct',
        'Por ingrediente',
        'Por comida',
        'COMPRAS',
        '5 ítems · 1 en el carrito',
        'Verduras',
        '5 u · Tomate',
        'Para 2 comidas',
        'Carnes',
        '600 g · Pollo',
        'Lácteos',
        '500 ml · Leche',
        'Granos',
        '800 g · Arroz',
        'Para 2 comidas',
        'No perecederos',
        '30 ml · Aceite de oliva',
        ...MANUAL_CARD,
        CART_BADGE,
      ]);
      expect(untilCalendar().anchor).toBeNull();
      expect(untilCalendar().rangeEnd).toBe('2026-10-10');
    });

    it('still offers every planned date once the list is limited to one of them', async () => {
      const root = await renderLoadedScreen();
      await press(root, UNTIL_THE_12TH);
      await pickUntilDate('2026-10-10');

      await press(root, 'Elegir hasta qué día comprar, ahora 10 Oct');

      expect(untilCalendar().markedDates).toEqual(['2026-10-08', '2026-10-10', '2026-10-12']);
      expect(untilCalendar().isDateSelectable?.('2026-10-12')).toBe(true);
      expect(untilCalendar().rangeStart).toBe('2026-10-08');
    });

    it('keeps limiting the list to the picked day when the grouping changes', async () => {
      const root = await renderLoadedScreen();
      await press(root, UNTIL_THE_12TH);
      await pickUntilDate('2026-10-10');

      await press(root, 'Por comida');

      expect(requestedUrls()[2]).toBe(`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`);
    });

    it('asks for every upcoming meal again when the last planned day is picked back', async () => {
      const root = await renderLoadedScreen();
      await press(root, UNTIL_THE_12TH);
      await pickUntilDate('2026-10-10');
      await press(root, 'Elegir hasta qué día comprar, ahora 10 Oct');

      await pickUntilDate('2026-10-12');

      expect(requestedUrls()[2]).toBe(`${LIST_URL}?groupBy=ingredient`);
      // Nothing is kept as chosen, so the list keeps reaching the last planned day as the plan grows.
      expect(useShoppingListStore.getState().chosenUntilDate).toBeUndefined();
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });

    it('closes on a tap outside without asking for anything', async () => {
      const root = await renderLoadedScreen();
      await press(root, UNTIL_THE_12TH);

      act(() => {
        untilCalendar().onClose();
      });
      await settle();

      expect(untilCalendar().anchor).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('goes back to the whole list when the server rejects the stored day', async () => {
      // A day this user chose while it was upcoming, which the Account's today has left behind.
      useShoppingListStore.setState({
        chosenUntilDate: '2026-10-01',
        chosenUntilDateOwnerId: USER_A.id,
      });
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(jsonResponse(SHOPPING_LIST_VALIDATION_ERROR, false, 422));
      answerOnceWith(SHOPPING_LIST_BY_INGREDIENT);

      const root = await renderLoadedScreen();

      expect(requestedUrls()).toEqual([
        `${LIST_URL}?untilDate=2026-10-01&groupBy=ingredient`,
        `${LIST_URL}?groupBy=ingredient`,
      ]);
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });
  });

  describe('a read with nothing to buy', () => {
    beforeEach(() => {
      fetchMock.mockReset();
      answerOnceWith(EMPTY_SHOPPING_LIST);
    });

    it('says there is nothing to buy, with no date to pick', async () => {
      const root = await renderLoadedScreen();

      expect(getTexts(root)).toEqual([
        'Por ingrediente',
        'Por comida',
        'COMPRAS',
        '0 ítems · 0 en el carrito',
        EMPTY_LABEL,
        ...MANUAL_CARD,
      ]);
      expect(mockFloatingCalendars).toEqual([]);
      expect(isLoading(root)).toBe(false);
    });

    it('still shows the date, and its calendar, while meals are planned and nothing is missing', async () => {
      fetchMock.mockReset();
      answerOnceWith({
        ...EMPTY_SHOPPING_LIST,
        plannedDates: SHOPPING_LIST_BY_INGREDIENT.plannedDates,
      });

      const root = await renderLoadedScreen();

      expect(getTexts(root)).toEqual([
        ...HEADER,
        '0 ítems · 0 en el carrito',
        EMPTY_LABEL,
        ...MANUAL_CARD,
      ]);
      expect(getButtonLabels(root)).toContain(UNTIL_THE_12TH);
    });
  });

  describe('a read that fails', () => {
    it('says so instead of the list, and offers to try again', async () => {
      fetchMock.mockReset();
      failTheNetworkOnce();

      const root = await renderLoadedScreen();

      expect(getTexts(root)).toEqual([
        'Por ingrediente',
        'Por comida',
        'COMPRAS',
        NETWORK_ERROR,
        RETRY,
      ]);
      expect(isLoading(root)).toBe(false);
    });

    it('reads the list again from the retry, and the message goes away', async () => {
      fetchMock.mockReset();
      failTheNetworkOnce();
      const root = await renderLoadedScreen();
      serveThePlan();

      await pressText(root, RETRY);

      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });

    it('shows that it is loading again while the retry is on its way', async () => {
      fetchMock.mockReset();
      failTheNetworkOnce();
      const root = await renderLoadedScreen();
      const request = holdTheNextRequest();

      await pressText(root, RETRY);

      expect(isLoading(root)).toBe(true);
      expect(getTexts(root)).not.toContain(NETWORK_ERROR);

      request.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();
    });

    it('keeps the last list under the message when a later read fails', async () => {
      const root = await renderLoadedScreen();
      fetchMock.mockReset();
      failTheNetworkOnce();

      await focusScreen();

      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        NETWORK_ERROR,
        RETRY,
        ...CARDS_BY_INGREDIENT,
      ]);
    });

    it('writes the message of the error the server answered with', async () => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, false, 403)
      );

      const root = await renderLoadedScreen();

      expect(getTexts(root)).toContain('No tenés permiso para hacer esto.');
    });
  });

  describe('coming back to the screen', () => {
    it('reads the list again', async () => {
      await renderLoadedScreen();

      await focusScreen();

      expect(requestedUrls()).toEqual([
        `${LIST_URL}?groupBy=ingredient`,
        `${LIST_URL}?groupBy=ingredient`,
      ]);
    });

    it('replaces what it showed with the new read, whole', async () => {
      const root = await renderLoadedScreen();
      fetchMock.mockReset();
      answerOnceWith(EMPTY_SHOPPING_LIST);

      await focusScreen();

      expect(getTexts(root)).toEqual([
        'Por ingrediente',
        'Por comida',
        'COMPRAS',
        '0 ítems · 0 en el carrito',
        EMPTY_LABEL,
        ...MANUAL_CARD,
      ]);
    });

    it('keeps the list on screen, shown as being read again, while the new read is on its way', async () => {
      const root = await renderLoadedScreen();
      const request = holdTheNextRequest();

      await focusScreen();

      expect(isLoading(root)).toBe(false);
      expect(isReadingAgain(root)).toBe(true);
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);

      request.answer(SHOPPING_LIST_UNTIL_OCT_10);
      await settle();

      expect(isReadingAgain(root)).toBe(false);
      expect(getTexts(root)).toContain('800 g · Arroz');
    });

    it('reads with the grouping and the day that were chosen before', async () => {
      const root = await renderLoadedScreen();
      await press(root, 'Por comida');
      await press(root, UNTIL_THE_12TH);
      await pickUntilDate('2026-10-10');

      await focusScreen();

      expect(requestedUrls()[3]).toBe(`${LIST_URL}?untilDate=2026-10-10&groupBy=meal`);
    });
  });

  describe('a read over the list on screen', () => {
    it('is shown next to the title, in a color of the palette, and not among the cards', async () => {
      const root = await renderLoadedScreen();
      const request = holdTheNextRequest();

      await focusScreen();

      const [indicator] = getIndicators(root, READING_AGAIN);
      expect(indicator.props.color).toBe('#222222');
      expect(root.findByType(ScrollView).findAllByType(ActivityIndicator)).toEqual([]);

      request.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();
    });

    it('takes the place of the message when a failed read is tried again, until it lands', async () => {
      const root = await renderLoadedScreen();
      fetchMock.mockReset();
      failTheNetworkOnce();
      await focusScreen();
      expect(getTexts(root)).toContain(NETWORK_ERROR);
      expect(isReadingAgain(root)).toBe(false);
      const request = holdTheNextRequest();

      await pressText(root, RETRY);

      expect(isReadingAgain(root)).toBe(true);
      expect(isLoading(root)).toBe(false);
      // The message is gone and the list is still there, with everything it offers to press.
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
      expect(getButtonLabels(root)).toEqual([
        UNTIL_THE_12TH,
        'Por ingrediente',
        'Por comida',
        'Cancelar carrito',
        ADD_LABEL,
        CART_BUTTON_LABEL,
      ]);

      request.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();

      expect(isReadingAgain(root)).toBe(false);
      expect(getTexts(root)).not.toContain(NETWORK_ERROR);
    });

    it('gives way to the message again when the retry fails too', async () => {
      const root = await renderLoadedScreen();
      fetchMock.mockReset();
      failTheNetworkOnce();
      await focusScreen();
      failTheNetworkOnce();

      await pressText(root, RETRY);

      expect(isReadingAgain(root)).toBe(false);
      expect(getTexts(root)).toEqual(expect.arrayContaining([NETWORK_ERROR, '1,25 kg · Arroz']));
    });

    it('is not shown on the first read: there is no list under it yet', async () => {
      const request = holdTheNextRequest();
      const root = renderScreen();
      await settle();

      expect(isLoading(root)).toBe(true);
      expect(isReadingAgain(root)).toBe(false);

      request.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();

      expect(isLoading(root)).toBe(false);
      expect(isReadingAgain(root)).toBe(false);
    });

    it('is not shown for the list of another user, read again when they left', async () => {
      const root = await renderLoadedScreen();
      const readOfUserA = holdTheNextRequest();
      await focusScreen();
      expect(isReadingAgain(root)).toBe(true);
      mockIsFocused = false;

      signInAs(USER_B);

      // Nothing was asked for yet, so the store still holds the list of the other user, with
      // its read on its way.
      expect(useShoppingListStore.getState()).toMatchObject({
        ownerId: 'user-a',
        list: SHOPPING_LIST_BY_INGREDIENT,
        status: 'loading',
      });
      expect(isReadingAgain(root)).toBe(false);
      expect(isLoading(root)).toBe(true);

      readOfUserA.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();
    });
  });

  describe('another user on the same device', () => {
    it('never draws the list read for the user before, even before it asks for its own', async () => {
      const root = await renderLoadedScreen();
      expect(getTexts(root)).toContain('1,25 kg · Arroz');
      mockIsFocused = false;

      signInAs(USER_B);

      // Nothing was asked for yet, so the store still holds the list of the other user.
      expect(useShoppingListStore.getState().list).toEqual(SHOPPING_LIST_BY_INGREDIENT);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getTexts(root)).toEqual(['Por ingrediente', 'Por comida', 'COMPRAS']);
      expect(isLoading(root)).toBe(true);
    });

    it('drops that list from the store as soon as its own read starts', async () => {
      const root = await renderLoadedScreen();
      const request = holdTheNextRequest();

      signInAs(USER_B);
      await settle();

      expect(useShoppingListStore.getState()).toMatchObject({ ownerId: 'user-b', list: null });
      expect(getTexts(root)).toEqual(['Por ingrediente', 'Por comida', 'COMPRAS']);
      expect(isLoading(root)).toBe(true);

      request.answer(SHOPPING_LIST_UNTIL_OCT_10);
      await settle();

      expect(getTexts(root)).toContain('800 g · Arroz');
      expect(getTexts(root)).not.toContain('1,25 kg · Arroz');
    });

    it('reads its whole list, not until the day the user before picked', async () => {
      const root = await renderLoadedScreen();
      await press(root, UNTIL_THE_12TH);
      await pickUntilDate('2026-10-10');
      expect(getTexts(root)).toContain('Hasta 10 Oct');

      signInAs(USER_B);
      await settle();

      // The plan of this user has a meal on the 10th too, so the server would take that day.
      expect(requestedUrls()[2]).toBe(`${LIST_URL}?groupBy=ingredient`);
      expect(useShoppingListStore.getState().chosenUntilDate).toBeUndefined();
      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });

    it('says its first read failed, without the list of the user before', async () => {
      const root = await renderLoadedScreen();
      fetchMock.mockReset();
      failTheNetworkOnce();

      signInAs(USER_B);
      await settle();

      expect(getTexts(root)).toEqual([
        'Por ingrediente',
        'Por comida',
        'COMPRAS',
        NETWORK_ERROR,
        RETRY,
      ]);
    });

    it('reads its own list from the retry', async () => {
      const root = await renderLoadedScreen();
      fetchMock.mockReset();
      failTheNetworkOnce();
      signInAs(USER_B);
      await settle();
      answerOnceWith(SHOPPING_LIST_UNTIL_OCT_10);

      await pressText(root, RETRY);

      expect(useShoppingListStore.getState().ownerId).toBe('user-b');
      expect(getTexts(root)).toContain('800 g · Arroz');
    });

    it('ignores the answer to the read of the user before when it lands late', async () => {
      const readOfUserA = holdTheNextRequest();
      const root = renderScreen();
      await settle();
      const readOfUserB = holdTheNextRequest();

      signInAs(USER_B);
      await settle();
      readOfUserA.answer(SHOPPING_LIST_BY_MEAL);
      await settle();

      expect(useShoppingListStore.getState().list).toBeNull();
      expect(getTexts(root)).toEqual(['Por ingrediente', 'Por comida', 'COMPRAS']);
      expect(isLoading(root)).toBe(true);

      readOfUserB.answer(SHOPPING_LIST_BY_INGREDIENT);
      await settle();

      expect(getTexts(root)).toEqual([
        ...HEADER,
        '6 ítems · 1 en el carrito',
        ...CARDS_BY_INGREDIENT,
      ]);
    });
  });

  describe('with nobody signed in', () => {
    it('has no list, asks for nothing and does not look like it is loading', async () => {
      mockUser = null;

      const root = await renderLoadedScreen();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(getTexts(root)).toEqual(['Por ingrediente', 'Por comida', 'COMPRAS']);
      expect(isLoading(root)).toBe(false);
    });

    it('stops showing the list of the user who signed out, and drops it', async () => {
      const root = await renderLoadedScreen();

      signInAs(null);
      await settle();

      expect(getTexts(root)).toEqual(['Por ingrediente', 'Por comida', 'COMPRAS']);
      expect(isLoading(root)).toBe(false);
      expect(useShoppingListStore.getState()).toMatchObject({ ownerId: null, list: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ShoppingScreen: items added by hand, removed and restored', () => {
  const REMOVED_LABEL = '1 quitado · Restaurar';
  const SOAP_ROW = '1 u · Detergente';
  const TOMATO_ROW = '5 u · Tomate, Para 2 comidas';

  // The server for these tests: the list it holds now, and the answer to each change. A
  // change that is accepted moves the list on to the one the test says it leads to.
  let serverList: ShoppingListRead;

  function serveChanges(
    changes: Record<string, { response: Response; leadsTo?: ShoppingListRead }>
  ) {
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      const path = url.replace('https://api.example.test', '').split('?')[0];
      const change = changes[`${init.method} ${path}`];

      if (change?.leadsTo) serverList = change.leadsTo;
      return Promise.resolve(change ? change.response : listResponse(serverList));
    });
  }

  const sentChanges = () =>
    fetchMock.mock.calls
      .filter(([url]) => !(url as string).includes('/api/shopping-list'))
      .map(([url, init]) => ({
        request: `${init.method} ${(url as string).replace('https://api.example.test', '')}`,
        body: init.body ? JSON.parse(init.body) : undefined,
      }));

  // A row is held to remove it: found by what it reads to a screen reader.
  async function hold(root: ReactTestInstance, label: string) {
    const row = root.find(
      (node) =>
        typeof node.props.onLongPress === 'function' && node.props.accessibilityLabel === label
    );

    act(() => {
      row.props.onLongPress();
    });
    await settle();
  }

  const getInputs = (root: ReactTestInstance) =>
    root.findAll((node) => node.props.accessibilityLabel === 'Nombre del producto');

  async function addThroughTheSheet(root: ReactTestInstance, name: string, quantity?: string) {
    await press(root, ADD_LABEL);
    act(() => {
      root.findByProps({ accessibilityLabel: 'Nombre del producto' }).props.onChangeText(name);
      if (quantity)
        root.findByProps({ accessibilityLabel: 'Cantidad' }).props.onChangeText(quantity);
    });
    await pressText(root, 'Agregar');
  }

  beforeEach(() => {
    serverList = SHOPPING_LIST_BY_INGREDIENT;
  });

  it('shows the manual items in their own card and the removed ones behind a restore line', async () => {
    serverList = SHOPPING_LIST_WITH_MANUAL_AND_REMOVED;
    serveChanges({});

    const root = await renderLoadedScreen();
    const texts = getTexts(root);

    expect(texts).toContain('Agregados a mano');
    expect(texts).toContain(SOAP_ROW);
    expect(texts).toContain(REMOVED_LABEL);
    expect(texts).not.toContain('5 u · Tomate');
    expect(texts).toContain('5 ítems · 1 en el carrito');
  });

  it('shows no restore line while nothing is removed', async () => {
    serveChanges({});

    const root = await renderLoadedScreen();

    expect(getTexts(root).some((text) => text.includes('Restaurar'))).toBe(false);
  });

  it('adds an item: asks for it with its quantity and unit, closes, and lists what the server reads', async () => {
    serveChanges({
      'POST /api/shopping-items/manual': {
        response: jsonResponse(toManualItemResponse(MANUAL_DISH_SOAP), true, 201),
        leadsTo: SHOPPING_LIST_WITH_MANUAL_AND_REMOVED,
      },
    });
    const root = await renderLoadedScreen();

    await addThroughTheSheet(root, 'Detergente', '2');

    expect(sentChanges()).toEqual([
      {
        request: 'POST /api/shopping-items/manual',
        body: { name: 'Detergente', quantityMilli: 2_000, unit: 'unit' },
      },
    ]);
    expect(getInputs(root)).toHaveLength(0);
    expect(getTexts(root)).toContain(SOAP_ROW);
  });

  it('deletes an item added by hand from a long press on its row', async () => {
    serverList = SHOPPING_LIST_WITH_MANUAL_AND_REMOVED;
    serveChanges({
      [`DELETE /api/shopping-items/${MANUAL_DISH_SOAP.id}`]: {
        response: jsonResponse(toDeleteItemResponse(MANUAL_DISH_SOAP.id)),
        leadsTo: { ...SHOPPING_LIST_WITH_MANUAL_AND_REMOVED, manual: [] },
      },
    });
    const root = await renderLoadedScreen();

    await hold(root, SOAP_ROW);

    expect(sentChanges().map(({ request }) => request)).toEqual([
      `DELETE /api/shopping-items/${MANUAL_DISH_SOAP.id}`,
    ]);
    expect(getTexts(root)).not.toContain(SOAP_ROW);
    expect(getTexts(root)).toContain('Todavía no agregaste nada.');
  });

  it('removes a planned item through every share of its line, and offers to restore it', async () => {
    serveChanges({
      'POST /api/shopping-items/set-status': {
        response: jsonResponse(toSetStatusResponse('removed', TOMATO_ITEM_IDS)),
        leadsTo: SHOPPING_LIST_WITH_MANUAL_AND_REMOVED,
      },
    });
    const root = await renderLoadedScreen();

    await hold(root, TOMATO_ROW);

    expect(sentChanges()).toEqual([
      {
        request: 'POST /api/shopping-items/set-status',
        body: { itemIds: TOMATO_ITEM_IDS, status: 'removed' },
      },
    ]);
    expect(getTexts(root)).not.toContain('5 u · Tomate');
    expect(getTexts(root)).toContain(REMOVED_LABEL);
  });

  it('restores the removed items from the restore line', async () => {
    serverList = SHOPPING_LIST_WITH_MANUAL_AND_REMOVED;
    serveChanges({
      'POST /api/shopping-items/set-status': {
        response: jsonResponse(toSetStatusResponse('needed', TOMATO_ITEM_IDS)),
        leadsTo: SHOPPING_LIST_BY_INGREDIENT,
      },
    });
    const root = await renderLoadedScreen();

    await press(root, REMOVED_LABEL);

    expect(sentChanges()).toEqual([
      {
        request: 'POST /api/shopping-items/set-status',
        body: { itemIds: TOMATO_ITEM_IDS, status: 'needed' },
      },
    ]);
    expect(getTexts(root)).toContain('5 u · Tomate');
    expect(getTexts(root).some((text) => text.includes('Restaurar'))).toBe(false);
  });

  it('says why an item in a Cart cannot be removed, keeps the list, and lets the message go', async () => {
    serveChanges({
      'POST /api/shopping-items/set-status': {
        response: jsonResponse(
          toShoppingErrorResponse('shopping_item_in_cart', 'In a Cart.'),
          false,
          409
        ),
      },
    });
    const root = await renderLoadedScreen();

    await hold(root, TOMATO_ROW);

    expect(getTexts(root)).toContain('Sacá el producto del carrito antes de quitarlo de la lista.');
    expect(getTexts(root)).toContain('5 u · Tomate');

    await pressText(root, 'Entendido');

    expect(getTexts(root)).not.toContain(
      'Sacá el producto del carrito antes de quitarlo de la lista.'
    );
  });

  it('shows that a change is being saved until the server answers', async () => {
    serveChanges({});
    const root = await renderLoadedScreen();
    const request = holdTheNextRequest();

    await hold(root, TOMATO_ROW);

    expect(getIndicators(root, 'Guardando los cambios')).toHaveLength(1);

    serveChanges({});
    request.answer(SHOPPING_LIST_BY_INGREDIENT);
    await settle();
    await settle();

    expect(getIndicators(root, 'Guardando los cambios')).toHaveLength(0);
  });
});

describe('ShoppingScreen: buying the Cart', () => {
  const CONFIRM_URL = 'https://api.example.test/api/checkout/confirm';
  const INVENTORY_URL = 'https://api.example.test/api/inventory';
  const MARK_CART_URL = 'https://api.example.test/api/shopping-items/mark-cart';
  const CART_BUTTON = 'Ver carrito, 2 ítems';
  const CONFIRM = 'Marcar como comprado';
  const RICE_QUANTITY = 'Cantidad comprada, Arroz';
  const OIL_QUANTITY = 'Cantidad comprada, Aceite de oliva';
  const CART_EXPIRED = 'El carrito venció y ya no se puede confirmar.';
  const CART_LOCKED = 'Otro integrante del hogar ya tiene esos productos en su carrito.';

  // The list the server holds now. A confirm it accepts leaves the Cart bought.
  let serverList: ShoppingListRead;

  function serve(confirmAnswer: () => Promise<Response>) {
    fetchMock.mockImplementation((url: string) => {
      if (url === CONFIRM_URL) {
        return confirmAnswer().then((response) => {
          if (response.ok) serverList = SHOPPING_LIST_AFTER_PURCHASE;
          return response;
        });
      }
      if (url.startsWith(INVENTORY_URL)) {
        return Promise.resolve(
          jsonResponse({ data: { sections: { expired: [], warning: [], ok: [] } } })
        );
      }
      if (url === MARK_CART_URL) {
        return Promise.resolve(
          jsonResponse({
            data: { sessionId: CART_SESSION_ID, leaseExpiresAt: '2026-10-08T18:30:00Z', items: [] },
          })
        );
      }
      return Promise.resolve(listResponse(serverList));
    });
  }

  const serveAPurchase = () => serve(() => Promise.resolve(jsonResponse(toCheckoutResponse())));

  const serveARefusal = (code: string, status: number) =>
    serve(() =>
      Promise.resolve(jsonResponse(toShoppingErrorResponse(code, 'Refused.'), false, status))
    );

  const callsTo = (prefix: string) =>
    fetchMock.mock.calls.filter(([url]) => (url as string).startsWith(prefix));

  const confirmBodies = () => callsTo(CONFIRM_URL).map(([, init]) => JSON.parse(init.body));

  const isSheetOpen = (root: ReactTestInstance) => getTexts(root).includes('Tu carrito');

  function typeQuantity(root: ReactTestInstance, label: string, text: string) {
    act(() => {
      root.findByProps({ accessibilityLabel: label }).props.onChangeText(text);
    });
  }

  async function openTheCart(): Promise<ReactTestInstance> {
    const root = await renderLoadedScreen();
    await press(root, CART_BUTTON);

    return root;
  }

  beforeEach(() => {
    serverList = SHOPPING_LIST_BY_INGREDIENT;
    useInventoryStore.setState(useInventoryStore.getInitialState(), true);
    serveAPurchase();
  });

  it('offers the Cart from a button that counts its lines, only while there is a Cart', async () => {
    const root = await renderLoadedScreen();

    expect(root.findAll((node) => node.props.testID === 'shopping-cart-button')).not.toEqual([]);
    expect(getButtonLabels(root)).toContain(CART_BUTTON);

    serverList = SHOPPING_LIST_AFTER_PURCHASE;
    await focusScreen();

    expect(root.findAll((node) => node.props.testID === 'shopping-cart-button')).toEqual([]);
  });

  describe('with a Cart that holds more than the chosen dates show', () => {
    const MILK_QUANTITY = 'Cantidad comprada, Leche';

    it('suggests the whole line of the Cart, not the part of it on the list', async () => {
      serverList = SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE;
      const root = await renderLoadedScreen();

      // The list reaches the 8th: it shows the 400 g of that day.
      expect(getTexts(root)).toContain('400 g · Arroz');

      await press(root, 'Ver carrito, 1 ítem');

      expect(getTexts(root)).toContain('Sugerido: 1250 g');
      expect(getTexts(root)).not.toContain('Sugerido: 400 g');
      expect(root.findByProps({ accessibilityLabel: RICE_QUANTITY }).props.value).toBe('1250');
    });

    it('sends a quantity adjusted on that line against the whole line', async () => {
      serverList = SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE;
      const root = await renderLoadedScreen();
      await press(root, 'Ver carrito, 1 ítem');

      typeQuantity(root, RICE_QUANTITY, '1249');
      await pressText(root, CONFIRM);

      expect(confirmBodies()).toEqual([
        {
          sessionId: CART_SESSION_ID,
          checkoutType: 'physical',
          lines: [{ itemId: RICE_LINE_ID, quantityMilli: 1_249_000 }],
        },
      ]);
    });

    it('sends no line while the suggested total of that line is left as it is', async () => {
      serverList = SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE;
      const root = await renderLoadedScreen();
      await press(root, 'Ver carrito, 1 ítem');

      await pressText(root, CONFIRM);

      expect(confirmBodies()).toEqual([{ sessionId: CART_SESSION_ID, checkoutType: 'physical' }]);
    });

    it('lists the lines of the Cart that are not on the list, and counts them on the button', async () => {
      serverList = SHOPPING_LIST_WITH_CART_OUT_OF_RANGE;
      const root = await renderLoadedScreen();
      const [button] = root.findAll((node) => node.props.testID === 'shopping-cart-button');

      expect(getTexts(button)).toEqual(['2']);

      await press(root, CART_BUTTON);

      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['Leche', 'Sugerido: 750 ml', 'Banana', 'Sugerido: 2 u'])
      );
      expect(getTexts(root)).not.toContain('Todavía no marcaste nada.');
    });

    it('buys a line that is not on the list at the quantity typed for it', async () => {
      serverList = SHOPPING_LIST_WITH_CART_OUT_OF_RANGE;
      const root = await renderLoadedScreen();
      await press(root, CART_BUTTON);

      typeQuantity(root, MILK_QUANTITY, '500');
      await pressText(root, CONFIRM);

      expect(confirmBodies()).toEqual([
        {
          sessionId: CART_SESSION_ID,
          checkoutType: 'physical',
          lines: [{ itemId: MILK_LINE_ID, quantityMilli: 500_000 }],
        },
      ]);
      expect(isSheetOpen(root)).toBe(false);
    });
  });

  it('leaves the share in the Cart of another member out of the Cart', async () => {
    const [rice, chicken, ...others] = SHOPPING_LIST_BY_INGREDIENT.planned;
    serverList = {
      ...SHOPPING_LIST_BY_INGREDIENT,
      planned: [
        rice,
        {
          ...chicken,
          status: 'in_cart',
          allocations: chicken.allocations.map((share) => ({ ...share, status: 'in_cart' })),
        },
        ...others,
      ],
      totals: { ...SHOPPING_LIST_BY_INGREDIENT.totals, needed: 4, inCart: 2 },
    };
    const root = await openTheCart();

    expect(root.findAllByProps({ accessibilityLabel: 'Cantidad comprada, Pollo' })).toEqual([]);
    expect(root.findAllByProps({ accessibilityLabel: RICE_QUANTITY })).not.toEqual([]);
    expect(root.findAllByProps({ accessibilityLabel: OIL_QUANTITY })).not.toEqual([]);
  });

  it('stops a quantity above what the server takes in the sheet', async () => {
    const root = await openTheCart();

    typeQuantity(root, RICE_QUANTITY, '2147484');
    await pressText(root, CONFIRM);

    expect(confirmBodies()).toEqual([]);
    expect(isSheetOpen(root)).toBe(true);
  });

  it('opens the Cart with each line and the quantity the Cart holds of it', async () => {
    const root = await openTheCart();

    expect(isSheetOpen(root)).toBe(true);
    expect(getTexts(root)).toEqual(expect.arrayContaining(['Sugerido: 400 g', 'Sugerido: 30 ml']));
    expect(root.findByProps({ accessibilityLabel: RICE_QUANTITY }).props.value).toBe('400');
    expect(root.findByProps({ accessibilityLabel: OIL_QUANTITY }).props.value).toBe('30');
  });

  it('buys the Cart in person in one tap, with no line while nothing was adjusted', async () => {
    const root = await openTheCart();

    await pressText(root, CONFIRM);

    expect(confirmBodies()).toEqual([{ sessionId: CART_SESSION_ID, checkoutType: 'physical' }]);
  });

  it('sends only the adjusted line, named by its ingredient and unit', async () => {
    const root = await openTheCart();

    typeQuantity(root, RICE_QUANTITY, '250');
    await pressText(root, CONFIRM);

    expect(confirmBodies()).toEqual([
      {
        sessionId: CART_SESSION_ID,
        checkoutType: 'physical',
        lines: [{ itemId: RICE_LINE_ID, quantityMilli: 250_000 }],
      },
    ]);
  });

  it('names the line by its ingredient and unit while the list is read per meal too', async () => {
    const root = await renderLoadedScreen();
    await press(root, 'Por comida');
    await press(root, CART_BUTTON);

    typeQuantity(root, RICE_QUANTITY, '0');
    typeQuantity(root, OIL_QUANTITY, '45');
    await pressText(root, CONFIRM);

    expect(confirmBodies()[0].lines).toEqual([
      { itemId: OLIVE_OIL_LINE_ID, quantityMilli: 45_000 },
      { itemId: RICE_LINE_ID, quantityMilli: 0 },
    ]);
  });

  it('closes, reads the list again and refreshes the Inventory once the Cart is bought', async () => {
    const root = await openTheCart();
    const readsBefore = callsTo(LIST_URL).length;

    await pressText(root, CONFIRM);

    expect(isSheetOpen(root)).toBe(false);
    expect(callsTo(LIST_URL)).toHaveLength(readsBefore + 1);
    expect(callsTo(INVENTORY_URL)).toHaveLength(1);
    expect(useInventoryStore.getState().loadStatus).toBe('ready');
    // The Cart is gone with the purchase: nothing is left to open or to abandon.
    expect(getButtonLabels(root)).not.toContain('Cancelar carrito');
    expect(root.findAll((node) => node.props.testID === 'shopping-cart-button')).toEqual([]);
  });

  it('sends one confirm when the button is pressed twice before the server answers', async () => {
    let answer: (response: Response) => void = () => {};
    serve(() => new Promise<Response>((resolve) => (answer = resolve)));
    const root = await openTheCart();
    const confirmButton = () =>
      getButtons(root).find((button) => getTexts(button).includes(CONFIRM))!;

    act(() => {
      confirmButton().props.onPress();
      confirmButton().props.onPress();
    });
    await settle();

    expect(confirmButton().props.disabled).toBe(true);
    act(() => {
      if (!confirmButton().props.disabled) confirmButton().props.onPress();
    });
    await settle();
    expect(callsTo(CONFIRM_URL)).toHaveLength(1);

    answer(jsonResponse(toCheckoutResponse()));
    await settle();

    expect(isSheetOpen(root)).toBe(false);
    expect(callsTo(CONFIRM_URL)).toHaveLength(1);
  });

  it.each([
    ['cart_expired', 409, CART_EXPIRED],
    ['checkout_session_not_found', 404, 'No encontramos esa compra.'],
  ])('closes, reads the list again and says why on `%s`', async (code, status, message) => {
    serveARefusal(code, status);
    const root = await openTheCart();
    const readsBefore = callsTo(LIST_URL).length;
    serverList = { ...SHOPPING_LIST_BY_INGREDIENT, cart: null };

    await pressText(root, CONFIRM);

    expect(isSheetOpen(root)).toBe(false);
    expect(callsTo(LIST_URL)).toHaveLength(readsBefore + 1);
    expect(callsTo(INVENTORY_URL)).toHaveLength(0);
    expect(getTexts(root)).toContain(message);
    expect(getButtonLabels(root)).not.toContain('Cancelar carrito');
  });

  it.each([
    ['cart_locked', 409, CART_LOCKED],
    ['validation_error', 422, 'Los datos ingresados no son válidos.'],
  ])(
    'stays open with the message on `%s`, with the Cart as it was',
    async (code, status, message) => {
      serveARefusal(code, status);
      const root = await openTheCart();
      const readsBefore = callsTo(LIST_URL).length;
      typeQuantity(root, RICE_QUANTITY, '250');

      await pressText(root, CONFIRM);

      expect(isSheetOpen(root)).toBe(true);
      expect(getTexts(root)).toContain(message);
      expect(root.findByProps({ accessibilityLabel: RICE_QUANTITY }).props.value).toBe('250');
      expect(callsTo(LIST_URL)).toHaveLength(readsBefore);
      expect(callsTo(INVENTORY_URL)).toHaveLength(0);

      // Closing it forgets the message: it is not there the next time the Cart is opened.
      await pressText(root, 'Cancelar');
      expect(getTexts(root)).not.toContain(message);
      await press(root, CART_BUTTON);
      expect(getTexts(root)).not.toContain(message);
    }
  );

  it('can be confirmed again after the network failed, and buys once', async () => {
    let attempts = 0;
    serve(() => {
      attempts += 1;
      // The transport asks twice before it gives up.
      return attempts <= 2
        ? Promise.reject(new TypeError('Network request failed'))
        : Promise.resolve(jsonResponse(toCheckoutResponse()));
    });
    const root = await openTheCart();

    await pressText(root, CONFIRM);
    expect(isSheetOpen(root)).toBe(true);
    expect(getTexts(root)).toContain(NETWORK_ERROR);

    await pressText(root, CONFIRM);

    expect(isSheetOpen(root)).toBe(false);
    expect(callsTo(INVENTORY_URL)).toHaveLength(1);
  });

  describe('once it is bought', () => {
    beforeEach(() => {
      serverList = SHOPPING_LIST_AFTER_PURCHASE;
    });

    it('shows a purchased line as bought, with nothing to tick or hold', async () => {
      const root = await renderLoadedScreen();
      const list = root.findByType(ScrollView);

      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['30 ml · Aceite de oliva', 'Comprado'])
      );
      expect(
        list.findAll(
          (node) => node.props.accessibilityLabel === '30 ml · Aceite de oliva, comprado'
        )
      ).not.toEqual([]);
      // The other five lines are still to buy.
      expect(getCheckboxes(root)).toHaveLength(5);
      expect(list.findAll((node) => typeof node.props.onLongPress === 'function')).toHaveLength(5);
      expect(getStruckNames(root)).toEqual([]);
    });

    it('shows what is still to buy of a line bought in part', async () => {
      const root = await renderLoadedScreen();

      // 150 g left of the first meal, and the two meals after it.
      expect(getTexts(root)).toContain('1 kg · Arroz');
      expect(getCheckboxes(root).map((row) => row.props.accessibilityLabel)).toContain(
        '1 kg · Arroz, Para 3 comidas'
      );
    });

    it('ticks only the shares of that line that are still to buy', async () => {
      const root = await renderLoadedScreen();
      const rice = getCheckboxes(root).find((row) =>
        String(row.props.accessibilityLabel).includes('Arroz')
      )!;

      act(() => {
        rice.props.onPress();
      });
      await settle();

      const [markCall] = callsTo(MARK_CART_URL);
      expect(JSON.parse(markCall[1].body)).toEqual({ itemIds: RICE_NEEDED_ITEM_IDS });
    });
  });
});
