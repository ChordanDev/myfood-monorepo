/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
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
  id: 'inv-milk',
  name: 'Leche entera',
  category: 'lacteos',
  quantity: 1000,
  unit: 'ml',
  confidence: 'estimated',
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
  it('prefills the name, the raw quantity with its unit and the notes', () => {
    const { root } = renderSheet({ ...MILK, notes: 'En la puerta' });

    expect(getInput(root, 'Nombre').props.value).toBe('Leche entera');
    expect(getInput(root, 'Cantidad').props.value).toBe('1000');
    expect(getInput(root, 'Notas').props.value).toBe('En la puerta');
    expect(getTexts(root)).toContain('ml');
  });

  it('prefills a decimal quantity with a comma and keeps it out of an unrelated save', () => {
    const { root, onSave } = renderSheet({ ...MILK, quantity: 0.5, unit: 'unit' });

    expect(getInput(root, 'Cantidad').props.value).toBe('0,5');
    expect(getTexts(root)).toContain('u');

    type(root, 'Notas', 'Media docena');
    press(root, 'Guardar');

    expect(onSave.mock.calls[0][0]).toStrictEqual({ notes: 'Media docena' });
  });

  it('asks for the quantity with a numeric keyboard', () => {
    const { root } = renderSheet();

    expect(getInput(root, 'Cantidad').props.keyboardType).toBe('decimal-pad');
  });

  it('saves only the notes when nothing else changed', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Notas', 'En la puerta');
    press(root, 'Guardar');

    expect(onSave).toHaveBeenCalledTimes(1);
    // An untouched quantity must stay out of the patch: the store marks any quantity it gets as exact.
    expect(onSave.mock.calls[0][0]).toStrictEqual({ notes: 'En la puerta' });
  });

  it('saves the parsed quantity when it changed', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Cantidad', '1,5');
    press(root, 'Guardar');

    expect(onSave.mock.calls[0][0]).toStrictEqual({ quantity: 1.5 });
  });

  it('leaves the quantity out when it is retyped with the same value', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Cantidad', '1000,0');
    press(root, 'Guardar');

    expect(onSave.mock.calls[0][0]).toStrictEqual({});
  });

  it('saves a renamed item without surrounding spaces', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Nombre', '  Leche descremada ');
    press(root, 'Guardar');

    expect(onSave.mock.calls[0][0]).toStrictEqual({ name: 'Leche descremada' });
  });

  it('saves emptied notes so they can be cleared', () => {
    const { root, onSave } = renderSheet({ ...MILK, notes: 'En la puerta' });

    type(root, 'Notas', '  ');
    press(root, 'Guardar');

    expect(onSave.mock.calls[0][0]).toStrictEqual({ notes: '' });
  });

  it('cannot be saved while the name is empty', () => {
    const { root, onSave } = renderSheet();

    type(root, 'Nombre', '   ');

    expect(getButton(root, 'Guardar').props.disabled).toBe(true);

    press(root, 'Guardar');

    expect(onSave).not.toHaveBeenCalled();
  });

  it.each(['', 'abc', '-1', '1.000,5'])('cannot be saved with the quantity "%s"', (quantity) => {
    const { root, onSave } = renderSheet();

    type(root, 'Cantidad', quantity);

    expect(getButton(root, 'Guardar').props.disabled).toBe(true);

    press(root, 'Guardar');

    expect(onSave).not.toHaveBeenCalled();
  });

  it('can be saved again once the fields are valid', () => {
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
