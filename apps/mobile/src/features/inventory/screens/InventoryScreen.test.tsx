/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { loadReactNative } from '@/testing/loadReactNative';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { INVENTORY_CATEGORY_COLORS } from '../constants/categories';
import {
  CHICKEN,
  INVENTORY_VIEW,
  MILK,
  ONION,
  RICE,
  STEW,
  VOICE_APPLY_RESULT,
  VOICE_APPLY_RESULT_CAPPED,
  VOICE_PREVIEW_AFTER_DRIFT,
  VOICE_PREVIEW_HIGH_CONFIDENCE,
  VOICE_PREVIEW_LOW_CONFIDENCE,
  VOICE_TRANSCRIPT_HIGH,
  VOICE_TRANSCRIPT_LOW,
  buildInventoryItem,
  dataResponse,
  errorResponse,
  mutationEvent,
} from '../fixtures';
import { useInventoryStore } from '../store';
import type { InventoryItem, InventoryView } from '../types';
import { InventoryScreen } from './InventoryScreen';

// What the screen runs when its tab gets the focus. The mount counts as the first focus.
let mockFocusEffect: (() => void) | null = null;

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    mockFocusEffect = effect;
    require('react').useEffect(effect, [effect]);
  },
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('access-1')),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// The window the screen is measured in: the one Jest gives by default. A test swaps it for a
// small phone, where the responsive title metrics are at their smallest.
const mockDefaultWindow = { width: 750, height: 1334, scale: 2, fontScale: 2 };
let mockWindow = mockDefaultWindow;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@/components', () => {
  const { Text, View } = require('react-native');

  return {
    NoisyBackground: () => null,
    SafeAreaContent: View,
    ShadowSurface: View,
    // The title at the size the screen asks for, as the real component draws it.
    TitlePrimary: ({ text, metrics }: { text: string; metrics: { titleFontSize: number } }) => (
      <Text style={{ fontSize: metrics.titleFontSize }}>{text}</Text>
    ),
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');

  return { LinearGradient: View };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return { __esModule: true, default: { View } };
});

jest.mock('@/hooks/useGradientCrossfade', () => ({
  useGradientCrossfade: (colors: [string, string]) => ({
    currentColors: colors,
    previousColors: colors,
    animatedStyle: {},
    AnimatedView: jest.requireActual('react-native').View,
  }),
}));

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({
    inputAnimatedStyle: {},
    isKeyboardOpen: false,
    keyboardLift: 0,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eeeeee',
      colorDark: '#111111',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
      textBlack: '#000000',
      textDark: '#222222',
      textLight: '#eeeeee',
      textMedium: '#bbbbbb',
    },
  }),
}));

const API_URL = 'https://api.example.test';

// The fake API the screen talks to: each test queues the answers it needs, the read first.
const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

const EMPTY_STATE = 'Todavía no hay nada en tu inventario.';
const LOADING = 'Cargando tu inventario…';
const VALIDATION_MESSAGE = 'Los datos ingresados no son válidos.';

function viewOf(items: InventoryItem[]): InventoryView {
  return {
    ...INVENTORY_VIEW,
    sections: {
      ok: items.filter((item) => item.freshness === 'ok'),
      warning: items.filter((item) => item.freshness === 'warning'),
      expired: items.filter((item) => item.freshness === 'expired'),
    },
  };
}

function queueRead(view: InventoryView = INVENTORY_VIEW) {
  fetchMock.mockReturnValueOnce(dataResponse(view));
}

function queueValidationError() {
  fetchMock.mockReturnValueOnce(
    errorResponse('validation_error', 'The request data is not valid.', 422)
  );
}

// A response the test settles by hand, to look at the screen while a request is on its way.
function deferredResponse() {
  let resolve!: (response: Promise<Response>) => void;
  const response = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { response, resolve };
}

// Types a name in the add sheet, lets the catalogue search answer `ingredient` and chooses it.
async function chooseFromCatalogue(
  root: ReactTestInstance,
  text: string,
  ingredient: { id: string; name: string }
) {
  fetchMock.mockReturnValueOnce(dataResponse([ingredient]));
  jest.useFakeTimers();
  try {
    type(root, 'Nombre', text);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  } finally {
    jest.useRealTimers();
  }
  press(root, ingredient.name);
}

function sentRequest(call: number) {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
}

let mountedScreen: ReturnType<typeof create> | null = null;

// Mounts the screen and lets the read it starts be answered.
async function renderScreen() {
  await act(async () => {
    mountedScreen = create(<InventoryScreen />);
  });

  return mountedScreen!.root;
}

beforeAll(loadReactNative, 30_000);

beforeEach(() => {
  mockRouterPush.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = API_URL;
  mockFocusEffect = null;
  useInventoryStore.setState({ items: [], loadStatus: 'idle', loadError: null });
});

// The store outlives each test, so a screen left mounted would re-render on the next setState.
afterEach(() => {
  mockWindow = mockDefaultWindow;
  act(() => {
    mountedScreen?.unmount();
  });
  mountedScreen = null;
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function findControls(root: ReactTestInstance, label: string, role = 'button') {
  return root.findAll(
    (node) =>
      node.props.accessibilityRole === role &&
      typeof node.props.onPress === 'function' &&
      (node.props.accessibilityLabel === label || getTexts(node).includes(label))
  );
}

function getControl(root: ReactTestInstance, label: string, role = 'button') {
  const [control] = findControls(root, label, role);

  if (!control) {
    throw new Error(`No ${role} labelled "${label}"`);
  }

  return control;
}

function press(root: ReactTestInstance, label: string, role = 'button') {
  act(() => {
    getControl(root, label, role).props.onPress();
  });
}

// Presses and lets the request the press started be answered.
async function pressAndSettle(root: ReactTestInstance, label: string) {
  await act(async () => {
    getControl(root, label).props.onPress();
  });
}

function type(root: ReactTestInstance, label: string, text: string) {
  const input = root
    .findAllByType(TextInput)
    .find((candidate) => candidate.props.accessibilityLabel === label);

  if (!input) {
    throw new Error(`No input labelled "${label}"`);
  }

  act(() => {
    input.props.onChangeText(text);
  });
}

// The size of "COMPRAS", the title of the shopping screen.
const SHOPPING_TITLE_FONT_SIZE = 28;

function getTitleFontSize(root: ReactTestInstance) {
  const title = root.findAllByType(Text).find((node) => node.props.children === 'INVENTARIO');

  return StyleSheet.flatten(title?.props.style).fontSize;
}

describe('InventoryScreen', () => {
  it('opens the leftovers list from its entry', async () => {
    queueRead();
    const root = await renderScreen();

    press(root, 'Ver sobras', 'link');

    expect(mockRouterPush).toHaveBeenCalledWith('/leftovers');
  });

  it('writes its title at the size of the shopping title', async () => {
    queueRead();
    const root = await renderScreen();

    expect(getTitleFontSize(root)).toBe(SHOPPING_TITLE_FONT_SIZE);
  });

  it('keeps that title size on a small phone', async () => {
    mockWindow = { width: 320, height: 568, scale: 2, fontScale: 1 };
    queueRead();

    const root = await renderScreen();

    expect(getTitleFontSize(root)).toBe(SHOPPING_TITLE_FONT_SIZE);
  });

  describe('reading the inventory', () => {
    it('reads the API when it opens and lists the lots by freshness, what to use first on top', async () => {
      queueRead();
      const root = await renderScreen();

      const texts = getTexts(root);

      expect(sentRequest(0)).toEqual({ url: `${API_URL}/api/inventory`, method: 'GET' });
      expect(texts.slice(0, 2)).toEqual([
        'INVENTARIO',
        'Revisá primero lo de arriba: lo vencido y lo que vence pronto.',
      ]);
      // Each section with its count, then its rows: quantity, name, notes, leftover mark.
      expect(texts.slice(texts.indexOf('Vencidos'))).toEqual([
        'Vencidos',
        1,
        '300 g',
        'Pollo',
        'Por vencer',
        1,
        '750 ml',
        'Leche',
        'Abierta',
        'En buen estado',
        3,
        '0,5 u',
        'Guiso de lentejas',
        'Del martes',
        'Sobra',
        '3 u',
        'Cebolla',
        '1,5 kg',
        'Arroz',
      ]);
      expect(texts).not.toContain(EMPTY_STATE);
      expect(texts).not.toContain(LOADING);
    });

    it('no longer tags a quantity as approximate', async () => {
      queueRead();
      const root = await renderScreen();

      expect(getTexts(root)).not.toContain('aprox.');
    });

    it('leaves out a section that has no items', async () => {
      queueRead(viewOf([RICE, MILK]));
      const root = await renderScreen();

      const texts = getTexts(root);

      expect(texts).toEqual(expect.arrayContaining(['Por vencer', 'En buen estado']));
      expect(texts).not.toContain('Vencidos');
    });

    it('paints a row with the display color of its category', async () => {
      queueRead(viewOf([RICE]));
      const root = await renderScreen();

      const colors = root
        .findAllByType(View)
        .map((view) => StyleSheet.flatten(view.props.style)?.backgroundColor);

      // The API files the rice under `no_perecederos`, which is drawn as "Despensa".
      expect(colors).toContain(INVENTORY_CATEGORY_COLORS.almacen);
    });

    it('says it is loading until the first read is answered', async () => {
      const read = deferredResponse();
      fetchMock.mockReturnValueOnce(read.response);
      const root = await renderScreen();

      expect(getTexts(root)).toContain(LOADING);
      expect(getTexts(root)).not.toContain(EMPTY_STATE);

      await act(async () => {
        read.resolve(dataResponse(INVENTORY_VIEW));
      });

      expect(getTexts(root)).not.toContain(LOADING);
      expect(getTexts(root)).toContain('Arroz');
    });

    it('shows the last read while a new one is on its way', async () => {
      useInventoryStore.setState({ items: [RICE], loadStatus: 'ready' });
      fetchMock.mockReturnValueOnce(deferredResponse().response);

      const root = await renderScreen();

      expect(getTexts(root)).toContain('Arroz');
      expect(getTexts(root)).not.toContain(LOADING);
    });

    it('says so when the inventory is empty', async () => {
      queueRead(viewOf([]));
      const root = await renderScreen();

      expect(getTexts(root)).toContain(EMPTY_STATE);
      expect(getTexts(root)).not.toContain(LOADING);
    });

    it('shows the message of the error when the read fails, and reads again on retry', async () => {
      fetchMock.mockReturnValueOnce(errorResponse('account_expired', 'Account expired', 403));
      const root = await renderScreen();

      const alert = root.find((node) => node.props.accessibilityRole === 'alert');

      expect(alert.props.children).toBe('El acceso de tu cuenta venció.');
      expect(getTexts(root).join(' ')).not.toContain('account_expired');
      expect(getTexts(root)).not.toContain(EMPTY_STATE);
      expect(getTexts(root)).not.toContain(LOADING);

      queueRead();
      await pressAndSettle(root, 'Reintentar');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getTexts(root)).toContain('Arroz');
      expect(getTexts(root)).not.toContain('El acceso de tu cuenta venció.');
      expect(findControls(root, 'Reintentar')).toHaveLength(0);
    });

    it('keeps the last read on screen under the error of a failed one', async () => {
      useInventoryStore.setState({ items: [RICE], loadStatus: 'ready' });
      fetchMock.mockReturnValueOnce(errorResponse('account_expired', 'Account expired', 403));

      const root = await renderScreen();

      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['El acceso de tu cuenta venció.', 'Reintentar', 'Arroz'])
      );
    });

    it('reads again every time its tab gets the focus back', async () => {
      queueRead(viewOf([RICE]));
      const root = await renderScreen();

      queueRead(viewOf([RICE, ONION]));
      await act(async () => {
        mockFocusEffect?.();
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getTexts(root)).toContain('Cebolla');
    });
  });

  describe('editing a lot', () => {
    it('sets the quantity in thousandths and draws the row the API answers', async () => {
      const updated = { ...MILK, quantityMilli: 1_500_000 };
      queueRead();
      const root = await renderScreen();

      expect(root.findAllByType(TextInput)).toHaveLength(0);

      press(root, 'Editar Leche');
      type(root, 'Cantidad', '1500');
      fetchMock.mockReturnValueOnce(
        dataResponse({ item: updated, mutationEvent: mutationEvent(updated) })
      );
      await pressAndSettle(root, 'Guardar');

      expect(sentRequest(1)).toEqual({
        url: `${API_URL}/api/inventory/items/${MILK.id}/quantity`,
        method: 'POST',
        body: { quantityMilli: 1_500_000 },
      });
      expect(getTexts(root)).toContain('1,5 L');
      expect(getTexts(root)).not.toContain('750 ml');
      // The sheet closed.
      expect(root.findAllByType(TextInput)).toHaveLength(0);
    });

    it('shows the name and the notes of the lot without letting them be edited', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Editar Leche');

      const inputs = root.findAllByType(TextInput);

      expect(inputs.map((input) => input.props.accessibilityLabel)).toEqual(['Cantidad']);
      expect(inputs[0].props.value).toBe('750');
    });

    it.each(['-1', 'mucho', ''])(
      'rejects the quantity "%s" without calling the API',
      async (quantity) => {
        queueRead();
        const root = await renderScreen();

        press(root, 'Editar Leche');
        type(root, 'Cantidad', quantity);

        expect(getControl(root, 'Guardar').props.disabled).toBe(true);

        await pressAndSettle(root, 'Guardar');

        // Only the read went out.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getTexts(root)).toContain('750 ml');
      }
    );

    it('shows the message of a validation error and leaves the list as it was', async () => {
      queueRead();
      const root = await renderScreen();
      const itemsBefore = useInventoryStore.getState().items;

      press(root, 'Editar Leche');
      type(root, 'Cantidad', '2');
      queueValidationError();
      await pressAndSettle(root, 'Guardar');

      const alert = root.find((node) => node.props.accessibilityRole === 'alert');

      expect(alert.props.children).toBe(VALIDATION_MESSAGE);
      expect(getTexts(root).join(' ')).not.toContain('validation_error');
      expect(useInventoryStore.getState().items).toBe(itemsBefore);
      expect(getTexts(root)).toContain('750 ml');
      // The sheet stays open, so the quantity can be corrected.
      expect(root.findAllByType(TextInput)).toHaveLength(1);
    });

    it('disposes of the lot through the API, which removes its row', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Editar Cebolla');
      fetchMock.mockReturnValueOnce(
        dataResponse({
          disposed: true,
          mutationEvent: mutationEvent(ONION, { operation: 'delete' }),
        })
      );
      await pressAndSettle(root, 'Borrar del inventario');

      expect(sentRequest(1)).toEqual({
        url: `${API_URL}/api/inventory/items/${ONION.id}/dispose`,
        method: 'POST',
      });
      expect(getTexts(root)).not.toContain('Cebolla');
      expect(getTexts(root)).toContain('Leche');
      expect(root.findAllByType(TextInput)).toHaveLength(0);
    });

    it('removes the section when its last lot is disposed of', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Editar Pollo');
      fetchMock.mockReturnValueOnce(
        dataResponse({
          disposed: true,
          mutationEvent: mutationEvent(CHICKEN, { operation: 'delete' }),
        })
      );
      await pressAndSettle(root, 'Borrar del inventario');

      expect(getTexts(root)).not.toContain('Vencidos');
    });

    it('keeps the row when the lot cannot be disposed of, with the message of the error', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Editar Cebolla');
      fetchMock.mockReturnValueOnce(
        errorResponse('inventory_item_not_found', 'Inventory item not found', 404)
      );
      await pressAndSettle(root, 'Borrar del inventario');

      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['No encontramos ese producto en tu inventario.', '3 u'])
      );
    });

    it('closes the sheet without calling the API when the edit is cancelled', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Editar Leche');
      press(root, 'Cancelar');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(root.findAllByType(TextInput)).toHaveLength(0);
    });
  });

  describe('adding an item from outside the app', () => {
    const YOGURT = buildInventoryItem({
      id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e06',
      ingredientId: '7d1e2f30-0000-4000-8000-000000000006',
      name: 'Yogur',
      category: 'lacteos',
      quantityMilli: 2_000,
      unit: 'unit',
      sourceKind: 'extra',
      acquiredAt: null,
      expiresAt: '2026-10-20',
      isLeftover: true,
      notes: 'Del desayuno',
    });

    it('sends the item to add-extra and draws the lot the API answers', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Agregar producto');
      await chooseFromCatalogue(root, 'yog', { id: YOGURT.ingredientId, name: 'Yogur' });
      type(root, 'Cantidad', '2');
      press(root, 'Unidades', 'radio');
      type(root, 'Vence', '20/10/2026');
      type(root, 'Notas', 'Del desayuno');
      press(root, 'Es una sobra', 'checkbox');
      fetchMock.mockReturnValueOnce(
        dataResponse({ item: YOGURT, mutationEvent: mutationEvent(YOGURT, { operation: 'add' }) })
      );
      await pressAndSettle(root, 'Agregar');

      expect(sentRequest(1)).toEqual({
        url: `${API_URL}/api/ingredients?query=yog`,
        method: 'GET',
        body: undefined,
      });
      expect(sentRequest(2)).toEqual({
        url: `${API_URL}/api/inventory/items/add-extra`,
        method: 'POST',
        body: {
          ingredientId: YOGURT.ingredientId,
          quantityMilli: 2_000,
          unit: 'unit',
          expiresAt: '2026-10-20',
          notes: 'Del desayuno',
          isLeftover: true,
        },
      });
      expect(getTexts(root)).toEqual(expect.arrayContaining(['2 u', 'Yogur', 'Del desayuno']));
      // The sheet closed.
      expect(root.findAllByType(TextInput)).toHaveLength(0);
    });

    it('sends only the Ingredient, the quantity and the unit when the rest is left blank', async () => {
      const moreRice = { ...RICE, quantityMilli: 2_000_000 };
      queueRead();
      const root = await renderScreen();

      press(root, 'Agregar producto');
      await chooseFromCatalogue(root, 'Arroz', { id: RICE.ingredientId, name: 'Arroz' });
      type(root, 'Cantidad', '500');
      fetchMock.mockReturnValueOnce(
        dataResponse({ item: moreRice, mutationEvent: mutationEvent(moreRice) })
      );
      await pressAndSettle(root, 'Agregar');

      expect(sentRequest(2).body).toEqual({
        ingredientId: RICE.ingredientId,
        quantityMilli: 500_000,
        unit: 'g',
      });
      // The add accumulated in the lot the inventory had: one row, with the total.
      expect(getTexts(root).filter((text) => text === 'Arroz')).toHaveLength(1);
      expect(getTexts(root)).toContain('2 kg');
    });

    it('shows the message of a validation error and leaves the list as it was', async () => {
      queueRead();
      const root = await renderScreen();
      const itemsBefore = useInventoryStore.getState().items;

      press(root, 'Agregar producto');
      await chooseFromCatalogue(root, 'Yogur', { id: YOGURT.ingredientId, name: 'Yogur' });
      type(root, 'Cantidad', '1');
      queueValidationError();
      await pressAndSettle(root, 'Agregar');

      expect(getTexts(root)).toContain(VALIDATION_MESSAGE);
      expect(getTexts(root).join(' ')).not.toContain('validation_error');
      expect(useInventoryStore.getState().items).toBe(itemsBefore);
      expect(root.findAllByType(TextInput).length).toBeGreaterThan(0);
    });

    it('rejects a quantity of zero without calling the API', async () => {
      queueRead();
      const root = await renderScreen();

      press(root, 'Agregar producto');
      await chooseFromCatalogue(root, 'Yogur', { id: YOGURT.ingredientId, name: 'Yogur' });
      type(root, 'Cantidad', '0');
      await pressAndSettle(root, 'Agregar');

      // The read and the catalogue search, and no add.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('can add to an empty inventory', async () => {
      queueRead(viewOf([]));
      const root = await renderScreen();

      press(root, 'Agregar producto');
      await chooseFromCatalogue(root, 'Guiso', {
        id: STEW.ingredientId,
        name: 'Guiso de lentejas',
      });
      type(root, 'Cantidad', '0,5');
      press(root, 'Unidades', 'radio');
      fetchMock.mockReturnValueOnce(
        dataResponse({ item: STEW, mutationEvent: mutationEvent(STEW, { operation: 'add' }) })
      );
      await pressAndSettle(root, 'Agregar');

      expect(getTexts(root)).toEqual(expect.arrayContaining(['En buen estado', '0,5 u']));
      expect(getTexts(root)).not.toContain(EMPTY_STATE);
    });
  });

  describe('voice adjustment', () => {
    const VOICE_BUTTON = 'Agregar o editar por voz';

    function voiceCalls() {
      return fetchMock.mock.calls
        .map((_call, index) => sentRequest(index))
        .filter(({ url }) => String(url).includes('/api/inventory/voice/'));
    }

    async function previewTranscript(root: ReactTestInstance, text: string) {
      press(root, VOICE_BUTTON);
      type(root, 'Qué usaste', text);
      await pressAndSettle(root, 'Interpretar');
    }

    it('opens the voice sheet from the voice button', async () => {
      queueRead();
      const root = await renderScreen();

      expect(root.findAllByType(TextInput)).toHaveLength(0);
      press(root, VOICE_BUTTON);

      expect(root.findAllByType(TextInput)).toHaveLength(1);
    });

    it('applies a high confidence intent right away, without confirmed, and patches the lot', async () => {
      queueRead();
      const root = await renderScreen();

      fetchMock.mockReturnValueOnce(dataResponse(VOICE_PREVIEW_HIGH_CONFIDENCE));
      fetchMock.mockReturnValueOnce(dataResponse(VOICE_APPLY_RESULT));
      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

      expect(voiceCalls().map(({ url }) => url)).toEqual([
        `${API_URL}/api/inventory/voice/preview`,
        `${API_URL}/api/inventory/voice/apply`,
      ]);
      expect(voiceCalls()[1].body).toEqual({
        transcript: VOICE_TRANSCRIPT_HIGH,
        intent: VOICE_PREVIEW_HIGH_CONFIDENCE.intent,
        confirmed: false,
        actionId: expect.any(String),
      });
      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['Listo', 'Descontamos 500 g de Arroz de tu inventario.', '1 kg'])
      );
    });

    it('never applies a low confidence intent until the User taps Confirm, then sends confirmed', async () => {
      queueRead();
      const root = await renderScreen();

      fetchMock.mockReturnValueOnce(dataResponse(VOICE_PREVIEW_LOW_CONFIDENCE));
      await previewTranscript(root, VOICE_TRANSCRIPT_LOW);

      expect(voiceCalls().map(({ url }) => url)).toEqual([
        `${API_URL}/api/inventory/voice/preview`,
      ]);
      expect(getTexts(root)).toContain('Entendimos: descontar 500 g de Arroz.');

      fetchMock.mockReturnValueOnce(dataResponse(VOICE_APPLY_RESULT));
      await pressAndSettle(root, 'Confirmar');

      expect(voiceCalls()).toHaveLength(2);
      expect(voiceCalls()[1]).toMatchObject({
        url: `${API_URL}/api/inventory/voice/apply`,
        body: {
          transcript: VOICE_TRANSCRIPT_LOW,
          intent: VOICE_PREVIEW_LOW_CONFIDENCE.intent,
          confirmed: true,
        },
      });
      expect(getTexts(root)).toContain('Descontamos 500 g de Arroz de tu inventario.');
    });

    it('never calls apply when the User cancels a low confidence intent', async () => {
      queueRead();
      const root = await renderScreen();

      fetchMock.mockReturnValueOnce(dataResponse(VOICE_PREVIEW_LOW_CONFIDENCE));
      await previewTranscript(root, VOICE_TRANSCRIPT_LOW);
      press(root, 'Cancelar');

      expect(voiceCalls().map(({ url }) => url)).toEqual([
        `${API_URL}/api/inventory/voice/preview`,
      ]);
      expect(getTexts(root)).toContain('1,5 kg');
    });

    it('asks to confirm a fresh preview when the API refuses the auto-apply, then says what it subtracted', async () => {
      queueRead();
      const root = await renderScreen();

      fetchMock.mockReturnValueOnce(dataResponse(VOICE_PREVIEW_HIGH_CONFIDENCE));
      fetchMock.mockReturnValueOnce(
        errorResponse('voice_confirmation_required', 'Confirmation required', 422)
      );
      fetchMock.mockReturnValueOnce(dataResponse(VOICE_PREVIEW_AFTER_DRIFT));
      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

      expect(voiceCalls().map(({ url }) => url)).toEqual([
        `${API_URL}/api/inventory/voice/preview`,
        `${API_URL}/api/inventory/voice/apply`,
        `${API_URL}/api/inventory/voice/preview`,
      ]);
      expect(voiceCalls()[2].body).toEqual({ transcript: VOICE_TRANSCRIPT_HIGH });
      expect(getTexts(root)).toContain('Entendimos: descontar 400 g de Arroz.');
      expect(getTexts(root)).not.toContain('Confirmá el ajuste antes de aplicarlo.');

      fetchMock.mockReturnValueOnce(dataResponse(VOICE_APPLY_RESULT_CAPPED));
      await pressAndSettle(root, 'Confirmar');

      expect(voiceCalls()).toHaveLength(4);
      expect(voiceCalls()[3].body).toEqual({
        transcript: VOICE_TRANSCRIPT_HIGH,
        intent: VOICE_PREVIEW_AFTER_DRIFT.intent,
        confirmed: true,
        // The confirmed apply is the same User action as the refused one.
        actionId: voiceCalls()[1].body.actionId,
      });
      // The API subtracted the 300 g the lot held, which emptied it.
      expect(getTexts(root)).toContain('Descontamos 300 g de Arroz de tu inventario.');
      expect(getTexts(root)).not.toContain('1,5 kg');
    });

    it('shows the message of a transcript that cannot be parsed and stays on the entry', async () => {
      queueRead();
      const root = await renderScreen();

      fetchMock.mockReturnValueOnce(errorResponse('voice_parse_failed', 'Cannot parse', 422));
      await previewTranscript(root, 'hola');

      expect(getTexts(root)).toContain(
        'No pudimos entender lo que dijiste. Probá de nuevo o ajustalo a mano.'
      );
      expect(voiceCalls()).toHaveLength(1);
      expect(root.findAllByType(TextInput)).toHaveLength(1);
    });
  });
});
