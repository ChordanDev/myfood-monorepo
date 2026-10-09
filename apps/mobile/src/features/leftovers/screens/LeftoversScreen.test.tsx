/* eslint-disable @typescript-eslint/no-require-imports */
/// <reference types="node" />
import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import {
  LEFTOVER_LENTILS,
  LEFTOVER_RICE,
  OPEN_LEFTOVERS,
  toLeftoverResponse,
  toLeftoversResponse,
} from '../fixtures';
import { LeftoversScreen } from './LeftoversScreen';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('expo-router', () => {
  const { useEffect } = require('react');

  return { useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]) };
});

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: jest.requireActual('@/components/SafeAreaContent').SafeAreaContent,
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eeeeee',
      colorDark: '#111111',
      colorLight: '#999999',
      textBlack: '#111111',
      textDark: '#222222',
      textLight: '#eeeeee',
    },
  }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

const LIST_URL = 'https://api.example.test/api/leftovers/prepared';

const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 404) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

const requests = () => fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`);

let tree: ReturnType<typeof create> | undefined;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderScreen(): Promise<ReactTestInstance> {
  act(() => {
    tree = create(<LeftoversScreen />);
  });
  await settle();

  return tree!.root;
}

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => String(node.props.children));
}

async function press(root: ReactTestInstance, label: string) {
  const target = root.find(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  );

  act(() => {
    target.props.onPress();
  });
  await settle();
}

describe('LeftoversScreen', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockSecureStore.set('auth_access_token', 'access-1');
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it('shows the leftovers in the order the server gives', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)));

    const root = await renderScreen();
    const shown = texts(root);

    expect(shown).toContain('Lentil stew');
    expect(shown).toContain('3 porciones · Consumir antes del 11 oct');
    expect(shown).toContain('In the blue container');
    expect(shown).toContain('1 porción · Consumir antes del 12 oct');
    expect(shown.indexOf('Lentil stew')).toBeLessThan(shown.indexOf('Rice'));
  });

  it('shows a loading indicator until the first read lands', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));

    const root = await renderScreen();

    expect(root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('shows an empty state without leftovers', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(toLeftoversResponse([])));

    const root = await renderScreen();

    expect(texts(root)).toContain('No tienes sobras');
    expect(root.findAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('consumes a leftover and reads the list again', async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse({ ...LEFTOVER_RICE, portions: 0 })))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([LEFTOVER_LENTILS])));

    const root = await renderScreen();
    await press(root, 'Comer Rice');

    expect(requests()).toEqual([
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-2/consume`,
      `GET ${LIST_URL}`,
    ]);
    expect(texts(root)).not.toContain('Rice');
    expect(texts(root)).toContain('Lentil stew');
  });

  it('discards a leftover and reads the list again', async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse(LEFTOVER_LENTILS)))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([LEFTOVER_RICE])));

    const root = await renderScreen();
    await press(root, 'Descartar Lentil stew');

    expect(requests()).toEqual([
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/discard`,
      `GET ${LIST_URL}`,
    ]);
    expect(texts(root)).not.toContain('Lentil stew');
  });

  it('shows the error of a failed action and keeps the list', async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(
        jsonResponse({ error: { code: 'prepared_leftover_not_found', message: 'gone' } }, false)
      )
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([LEFTOVER_RICE])));

    const root = await renderScreen();
    await press(root, 'Comer Lentil stew');

    expect(texts(root)).toContain('No encontramos esa sobra.');
  });

  it('shows an error and retries when the list cannot be read', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)));

    const root = await renderScreen();

    expect(root.findAll((node) => node.props.accessibilityRole === 'alert')).not.toHaveLength(0);
    expect(texts(root)).not.toContain('No tienes sobras');

    const retry = root.find(
      (node) =>
        node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
    );
    act(() => {
      retry.props.onPress();
    });
    await settle();

    expect(texts(root)).toContain('Lentil stew');
    expect(root.findAll((node) => node.props.accessibilityRole === 'alert')).toHaveLength(0);
  });
});
