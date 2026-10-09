/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { MILK as MILK_LOT } from '../mocks';
import type { InventoryItem } from '../types';
import { InventoryEditSheet } from './InventoryEditSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return { __esModule: true, default: { View } };
});

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: false }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111111',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
      textBlack: '#000000',
      textLight: '#eeeeee',
      textMedium: '#bbbbbb',
    },
  }),
}));

const MILK: InventoryItem = {
  ...MILK_LOT,
  name: 'Leche entera',
  quantityMilli: 1_000_000,
  notes: null,
};

function renderSheet(item: InventoryItem = MILK) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<InventoryEditSheet visible item={item} onSave={onSave} onClose={onClose} />);
  });

  return { root: tree!.root, onSave, onClose };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getInput(root: ReactTestInstance, label: string): ReactTestInstance {
  const input = root
    .findAllByType(TextInput)
    .find((candidate) => candidate.props.accessibilityLabel === label);

  if (!input) {
    throw new Error(`No input labelled "${label}"`);
  }

  return input;
}

function type(root: ReactTestInstance, label: string, text: string) {
  act(() => {
    getInput(root, label).props.onChangeText(text);
  });
}

function getButton(root: ReactTestInstance, label: string): ReactTestInstance {
  const button = root
    .findAll(
      (node) =>
        node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
    )
    .find(
      (candidate) =>
        candidate.props.accessibilityLabel === label || getTexts(candidate).includes(label)
    );

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  return button;
}

function press(root: ReactTestInstance, label: string) {
  act(() => {
    getButton(root, label).props.onPress();
  });
}

describe('InventoryEditSheet', () => {
  it('shows the name and the notes as text and prefills the raw quantity with its unit', () => {
    const { root } = renderSheet({ ...MILK, notes: 'En la puerta' });

    expect(root.findAllByType(TextInput)).toHaveLength(1);
    expect(getInput(root, 'Cantidad').props.value).toBe('1000');
    expect(getTexts(root)).toEqual(expect.arrayContaining(['Leche entera', 'En la puerta', 'ml']));
  });

  it('prefills a decimal quantity with a comma', () => {
    const { root } = renderSheet({ ...MILK, quantityMilli: 500, unit: 'unit' });

    expect(getInput(root, 'Cantidad').props.value).toBe('0,5');
    expect(getTexts(root)).toContain('u');
  });

  it('asks for the quantity with a numeric keyboard', () => {
    const { root } = renderSheet();

    expect(getInput(root, 'Cantidad').props.keyboardType).toBe('decimal-pad');
  });

  it('saves the typed quantity in thousandths', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Cantidad', '1,5');
    press(root, 'Guardar');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(1500);
  });

  it('saves zero, which empties the lot', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Cantidad', '0');
    press(root, 'Guardar');

    expect(onSave).toHaveBeenCalledWith(0);
  });

  it.each(['', 'abc', '-1', '1.000,5'])('cannot be saved with the quantity "%s"', (quantity) => {
    const { root, onSave } = renderSheet();

    type(root, 'Cantidad', quantity);

    expect(getButton(root, 'Guardar').props.disabled).toBe(true);

    press(root, 'Guardar');

    expect(onSave).not.toHaveBeenCalled();
  });

  it('can be saved again once the quantity is valid', () => {
    const { root } = renderSheet();

    type(root, 'Cantidad', 'abc');
    type(root, 'Cantidad', '750');

    expect(getButton(root, 'Guardar').props.disabled).toBe(false);
  });

  it('closes from the cancel action and from the backdrop without saving', () => {
    const { root, onSave, onClose } = renderSheet();

    press(root, 'Cancelar');
    press(root, 'Cerrar');

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
