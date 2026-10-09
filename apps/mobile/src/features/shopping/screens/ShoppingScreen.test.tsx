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
  EMPTY_SHOPPING_LIST,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_VALIDATION_ERROR,
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

  describe('a read-only list', () => {
    it('lets a row be ticked, with no removal and no "Marcar todos"', async () => {
      const root = await renderLoadedScreen();
      const list = root.findByType(ScrollView);

      expect(
        list.findAll(
          (node) =>
            typeof node.props.onLongPress === 'function' ||
            typeof node.props.onAccessibilityAction === 'function'
        )
      ).toEqual([]);
      expect(getTexts(root)).not.toContain('Marcar todos');
      expect(getCheckboxes(root)).toHaveLength(6);
    });

    it('offers the date, the two groupings and the abandoning of the Cart to press', async () => {
      const root = await renderLoadedScreen();

      expect(getButtonLabels(root)).toEqual([
        UNTIL_THE_12TH,
        'Por ingrediente',
        'Por comida',
        'Cancelar carrito',
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

    it('keeps the cart, the items added by hand and the removed rows off the screen', async () => {
      const root = await renderLoadedScreen();

      expect(root.findAll((node) => node.props.testID === 'shopping-cart-button')).toEqual([]);
      expect(getTexts(root)).not.toContain('Agregados a mano');
      expect(getTexts(root).some((text) => text.includes('Restaurar'))).toBe(false);
    });

    it('clears the tab bar, without letting iOS add the safe area again', async () => {
      const root = await renderLoadedScreen();
      const list = root.findByType(ScrollView);

      expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
      // The tab bar and a gap: the last card scrolls clear of it.
      expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(
        34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + 14
      );
    });
  });

  describe('shopping with a Cart lease', () => {
    const RICE_ITEM_IDS = [
      'ec18bfeb-0d2c-4e11-b772-e6e2fa3d9473',
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

    it('ticks all the items behind a line into the Cart and reads the list again', async () => {
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

      expect(getTexts(root)).toEqual([...HEADER, '0 ítems · 0 en el carrito', EMPTY_LABEL]);
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
