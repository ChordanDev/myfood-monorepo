/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { InventoryVoiceButton } from '../components';
import { MILK, ONION, RICE, dataResponse, errorResponse, mutationEvent } from '../mocks';
import { useInventoryStore } from '../store';
import type { InventoryItem } from '../types';
import { InventoryScreen } from './InventoryScreen';

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
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: false }),
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

// The API the screen talks to: each test queues the answers it needs.
const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = API_URL;
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

function sentRequest(call = 0) {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
}

const EMPTY_STATE = 'Todavía no hay nada en tu inventario.';

let mountedScreen: ReturnType<typeof create> | null = null;

function renderScreen(items: InventoryItem[]) {
  useInventoryStore.setState({ items });

  act(() => {
    mountedScreen = create(<InventoryScreen />);
  });

  return mountedScreen!.root;
}

// The store outlives each test, so a screen left mounted would re-render on the next setState.
afterEach(() => {
  mockWindow = mockDefaultWindow;
  act(() => {
    mountedScreen?.unmount();
  });
  mountedScreen = null;
});

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function findButtons(root: ReactTestInstance, label: string): ReactTestInstance[] {
  return root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      (node.props.accessibilityLabel === label || getTexts(node).includes(label))
  );
}

function press(root: ReactTestInstance, label: string) {
  const [button] = findButtons(root, label);

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  act(() => {
    button.props.onPress();
  });
}

// Presses and lets the request the press started be answered.
async function pressAndSettle(root: ReactTestInstance, label: string) {
  const [button] = findButtons(root, label);

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  await act(async () => {
    button.props.onPress();
  });
}

function findStoredItem(id: string) {
  return useInventoryStore.getState().items.find((item) => item.id === id);
}

// The size of "COMPRAS", the title of the shopping screen.
const SHOPPING_TITLE_FONT_SIZE = 28;

function getTitleFontSize(root: ReactTestInstance) {
  const title = root.findAllByType(Text).find((node) => node.props.children === 'INVENTARIO');

  return StyleSheet.flatten(title?.props.style).fontSize;
}

describe('InventoryScreen', () => {
  it('writes its title at the size of the shopping title', () => {
    const root = renderScreen([MILK]);

    expect(getTitleFontSize(root)).toBe(SHOPPING_TITLE_FONT_SIZE);
  });

  it('keeps that title size on a small phone', () => {
    mockWindow = { width: 320, height: 568, scale: 2, fontScale: 1 };

    const root = renderScreen([MILK]);

    expect(getTitleFontSize(root)).toBe(SHOPPING_TITLE_FONT_SIZE);
  });

  it('lists what is in stock grouped by category, under the title and the hint', () => {
    const root = renderScreen([MILK, ONION, RICE]);

    const texts = getTexts(root);

    expect(texts).toEqual(
      expect.arrayContaining([
        'INVENTARIO',
        'Cantidades aproximadas. Decile al micrófono qué usaste.',
        'Verduras',
        'Cebolla',
        '3 u',
        'Lácteos',
        'Leche',
        '750 ml',
        'Despensa',
        'Arroz',
        '1,5 kg',
      ])
    );
    expect(texts.indexOf('Verduras')).toBeLessThan(texts.indexOf('Lácteos'));
    expect(texts).not.toContain(EMPTY_STATE);
  });

  it('says so when nothing is in stock', () => {
    const root = renderScreen([]);

    expect(getTexts(root)).toContain(EMPTY_STATE);
  });

  it('disposes of an item through the API, which removes its row', async () => {
    fetchMock.mockReturnValueOnce(
      dataResponse({ disposed: true, mutationEvent: mutationEvent(ONION, { operation: 'delete' }) })
    );
    const root = renderScreen([MILK, ONION]);

    await pressAndSettle(root, 'Borrar Cebolla');

    expect(sentRequest()).toEqual({
      url: `${API_URL}/api/inventory/items/${ONION.id}/dispose`,
      method: 'POST',
    });
    expect(findStoredItem(ONION.id)).toBeUndefined();
    expect(getTexts(root)).not.toContain('Cebolla');
    expect(getTexts(root)).toContain('Leche');
  });

  it('sets the quantity through the sheet, in thousandths, and closes it on save', async () => {
    const updated = { ...MILK, quantityMilli: 1_500_000 };
    fetchMock.mockReturnValueOnce(
      dataResponse({ item: updated, mutationEvent: mutationEvent(updated) })
    );
    const root = renderScreen([MILK, ONION]);

    expect(root.findAllByType(TextInput)).toHaveLength(0);

    press(root, 'Editar Leche');
    act(() => {
      root.findByType(TextInput).props.onChangeText('1500');
    });
    await pressAndSettle(root, 'Guardar');

    expect(sentRequest()).toEqual({
      url: `${API_URL}/api/inventory/items/${MILK.id}/quantity`,
      method: 'POST',
      body: { quantityMilli: 1_500_000 },
    });
    expect(findStoredItem(MILK.id)).toEqual(updated);
    expect(getTexts(root)).toContain('1,5 L');
    expect(root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('leaves the list as it was when the API rejects a write', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('inventory_item_not_found', 'Inventory item not found', 404)
    );
    const root = renderScreen([MILK, ONION]);

    await pressAndSettle(root, 'Borrar Cebolla');

    expect(findStoredItem(ONION.id)).toEqual(ONION);
    expect(getTexts(root)).toContain('Cebolla');
  });

  it('closes the sheet without touching the item when the edit is cancelled', () => {
    const root = renderScreen([MILK]);

    press(root, 'Editar Leche');
    press(root, 'Cancelar');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findStoredItem(MILK.id)).toEqual(MILK);
    expect(root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('offers the voice button without wiring it to anything yet', () => {
    const root = renderScreen([MILK]);

    expect(root.findByType(InventoryVoiceButton).props.onPress).toBeUndefined();
  });
});
