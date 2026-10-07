/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { InventoryVoiceButton } from '../components';
import { useInventoryStore } from '../store';
import type { InventoryItem } from '../types';
import { InventoryScreen } from './InventoryScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/components', () => {
  const { Text, View } = require('react-native');

  return {
    NoisyBackground: () => null,
    SafeAreaContent: View,
    ShadowSurface: View,
    TitlePrimary: ({ text }: { text: string }) => <Text>{text}</Text>,
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

const MILK: InventoryItem = {
  id: 'inv-milk',
  name: 'Leche',
  category: 'lacteos',
  quantity: 1000,
  unit: 'ml',
  confidence: 'estimated',
};

const ONION: InventoryItem = {
  id: 'inv-onion',
  name: 'Cebolla',
  category: 'verduras',
  quantity: 3,
  unit: 'unit',
  confidence: 'exact',
};

const FINISHED_RICE: InventoryItem = {
  id: 'inv-rice',
  name: 'Arroz',
  category: 'almacen',
  quantity: 0,
  unit: 'g',
  confidence: 'exact',
};

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

function findStoredItem(id: string) {
  return useInventoryStore.getState().items.find((item) => item.id === id);
}

describe('InventoryScreen', () => {
  it('lists what is in stock grouped by category, under the title and the hint', () => {
    const root = renderScreen([MILK, ONION, FINISHED_RICE]);

    const texts = getTexts(root);

    expect(texts).toEqual(
      expect.arrayContaining([
        'INVENTARIO',
        'Cantidades aproximadas. Decile al micrófono qué usaste.',
        'Verduras',
        'Cebolla',
        'Lácteos',
        'Leche',
      ])
    );
    expect(texts.indexOf('Verduras')).toBeLessThan(texts.indexOf('Lácteos'));
    expect(texts).not.toContain(EMPTY_STATE);
  });

  it('leaves out items that ran out', () => {
    const root = renderScreen([MILK, FINISHED_RICE]);

    expect(getTexts(root)).not.toContain('Arroz');
    expect(getTexts(root)).not.toContain('Despensa');
  });

  it('says so when nothing is in stock', () => {
    const root = renderScreen([FINISHED_RICE]);

    expect(getTexts(root)).toContain(EMPTY_STATE);
  });

  it('deletes an item by zeroing its quantity, which removes its row', () => {
    const root = renderScreen([MILK, ONION]);

    press(root, 'Borrar Cebolla');

    expect(findStoredItem('inv-onion')).toEqual({ ...ONION, quantity: 0 });
    expect(getTexts(root)).not.toContain('Cebolla');
    expect(getTexts(root)).toContain('Leche');
  });

  it('edits an item through the sheet and closes it on save', () => {
    const root = renderScreen([MILK, ONION]);

    expect(root.findAllByType(TextInput)).toHaveLength(0);

    press(root, 'Editar Leche');

    const notes = root
      .findAllByType(TextInput)
      .find((input) => input.props.accessibilityLabel === 'Notas');

    act(() => {
      notes!.props.onChangeText('En la puerta');
    });
    press(root, 'Guardar');

    // Only the notes were sent, so the quantity is still an estimate.
    expect(findStoredItem('inv-milk')).toEqual({ ...MILK, notes: 'En la puerta' });
    expect(root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('closes the sheet without touching the item when the edit is cancelled', () => {
    const root = renderScreen([MILK]);

    press(root, 'Editar Leche');
    press(root, 'Cancelar');

    expect(findStoredItem('inv-milk')).toEqual(MILK);
    expect(root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('offers the voice button without wiring it to anything yet', () => {
    const root = renderScreen([MILK]);

    expect(root.findByType(InventoryVoiceButton).props.onPress).toBeUndefined();
  });
});
