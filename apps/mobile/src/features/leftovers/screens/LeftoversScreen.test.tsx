/* eslint-disable @typescript-eslint/no-require-imports */
/// <reference types="node" />
import React from 'react';
import { ActivityIndicator, Text, TextInput } from 'react-native';
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

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: false }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eeeeee',
      colorDark: '#111111',
      colorLight: '#999999',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
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
const sentBody = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

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

// Finds a control by its accessibility label, or by the text it shows when it has none.
async function press(root: ReactTestInstance, label: string) {
  const target = root.find(
    (node) =>
      typeof node.props.onPress === 'function' &&
      (node.props.accessibilityLabel === label ||
        (node.props.accessibilityLabel === undefined && texts(node).includes(label)))
  );

  act(() => {
    target.props.onPress();
  });
  await settle();
}

function type(root: ReactTestInstance, label: string, text: string) {
  const input = root
    .findAllByType(TextInput)
    .find((candidate) => candidate.props.accessibilityLabel === label)!;

  act(() => {
    input.props.onChangeText(text);
  });
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

  it('eats again under the same actionId after a failure while the portions did not change', async () => {
    const eaten = { ...LEFTOVER_LENTILS, portions: 2 };
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse(eaten)))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([eaten, LEFTOVER_RICE])))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse({ ...eaten, portions: 1 })))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([LEFTOVER_RICE])));

    const root = await renderScreen();
    await press(root, 'Comer Lentil stew');
    await press(root, 'Comer Lentil stew');
    await press(root, 'Comer Lentil stew');

    expect(requests()).toEqual([
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/consume`,
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/consume`,
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/consume`,
      `GET ${LIST_URL}`,
    ]);
    // The retry is the same tap; once the list shows two portions, the next tap is a new one.
    expect(sentBody(3).actionId).toBe(sentBody(1).actionId);
    expect(sentBody(5).actionId).not.toBe(sentBody(1).actionId);
  });

  it('keeps a failed Eat actionId while another leftover is eaten in between', async () => {
    const network = () => Promise.reject(new TypeError('Network request failed'));
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockImplementationOnce(network)
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockImplementationOnce(network)
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse({ ...LEFTOVER_LENTILS, portions: 2 })))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)));

    const root = await renderScreen();
    await press(root, 'Comer Lentil stew');
    await press(root, 'Comer Rice');
    await press(root, 'Comer Lentil stew');

    expect(requests()).toEqual([
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/consume`,
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-2/consume`,
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/consume`,
      `GET ${LIST_URL}`,
    ]);
    // The tap on Rice is its own intent; the second Lentil stew tap is still the first one.
    expect(sentBody(5).actionId).toBe(sentBody(1).actionId);
    expect(sentBody(3).actionId).not.toBe(sentBody(1).actionId);
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

  it('reads the list again after a failed action and keeps its error on screen', async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(
        jsonResponse({ error: { code: 'prepared_leftover_not_found', message: 'gone' } }, false)
      )
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([LEFTOVER_RICE])));

    const root = await renderScreen();
    await press(root, 'Comer Lentil stew');

    expect(requests()).toEqual([
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}/leftover-1/consume`,
      `GET ${LIST_URL}`,
    ]);
    expect(texts(root)).toContain('No encontramos esa sobra.');
    expect(texts(root)).not.toContain('Lentil stew');
    expect(texts(root)).toContain('Rice');
  });

  it('adds a loose leftover from its sheet and reads the list again', async () => {
    const added = { ...LEFTOVER_RICE, id: 'leftover-3', title: 'Soup', portions: 2 };
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse(added), true, 201))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([...OPEN_LEFTOVERS, added])));

    const root = await renderScreen();
    await press(root, 'Agregar sobra');
    type(root, 'Nombre de la sobra', 'Soup');
    type(root, 'Porciones', '2');
    await press(root, 'Guardar');

    expect(requests()).toEqual([`GET ${LIST_URL}`, `POST ${LIST_URL}`, `GET ${LIST_URL}`]);
    expect(sentBody(1)).toEqual({ title: 'Soup', portions: 2, actionId: expect.any(String) });
    expect(texts(root)).toContain('Soup');
    expect(root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('stores again under the same actionId after a failure while the input did not change', async () => {
    const added = { ...LEFTOVER_RICE, id: 'leftover-3', title: 'Soups', portions: 2 };
    fetchMock
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockReturnValueOnce(jsonResponse(toLeftoverResponse(added), true, 201))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse([...OPEN_LEFTOVERS, added])));

    const root = await renderScreen();
    await press(root, 'Agregar sobra');
    type(root, 'Nombre de la sobra', 'Soup');
    type(root, 'Porciones', '2');
    await press(root, 'Guardar');
    await press(root, 'Guardar');
    type(root, 'Nombre de la sobra', 'Soups');
    await press(root, 'Guardar');

    expect(requests()).toEqual([
      `GET ${LIST_URL}`,
      `POST ${LIST_URL}`,
      `POST ${LIST_URL}`,
      `POST ${LIST_URL}`,
      `GET ${LIST_URL}`,
    ]);
    // The retry is the same leftover; once the input changes, it is a new one.
    expect(sentBody(2).actionId).toBe(sentBody(1).actionId);
    expect(sentBody(3).actionId).not.toBe(sentBody(1).actionId);
    expect(sentBody(3).title).toBe('Soups');
  });

  it('shows an error and retries when the list cannot be read', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockReturnValueOnce(jsonResponse(toLeftoversResponse(OPEN_LEFTOVERS)));

    const root = await renderScreen();

    expect(root.findAll((node) => node.props.accessibilityRole === 'alert')).not.toHaveLength(0);
    expect(texts(root)).not.toContain('No tienes sobras');

    await press(root, 'Reintentar');

    expect(texts(root)).toContain('Lentil stew');
    expect(root.findAll((node) => node.props.accessibilityRole === 'alert')).toHaveLength(0);
  });
});
