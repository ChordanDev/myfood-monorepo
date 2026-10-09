/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import type { AddExtraItemPayload } from '../types';
import { InventoryAddSheet } from './InventoryAddSheet';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

// iOS keeps the children of a modal mounted while it fades out; the stock Jest mock drops
// them at once. They are kept here, so a test sees what a closing sheet still has on screen.
jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return { __esModule: true, default: { View } };
});

// How far the keyboard lifts the panel: zero while it is closed.
let mockKeyboardLift = 0;

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({
    inputAnimatedStyle: {},
    isKeyboardOpen: mockKeyboardLift > 0,
    keyboardLift: mockKeyboardLift,
  }),
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

const VALIDATION_ERROR = new ApiError('validation_error', 'The request data is not valid.', 422);
const VALIDATION_MESSAGE = 'Los datos ingresados no son válidos.';

function renderSheet() {
  const onAdd = jest.fn((_payload: AddExtraItemPayload) => Promise.resolve());
  const onClose = jest.fn();
  let tree: ReturnType<typeof create>;

  const sheet = (visible: boolean) => (
    <InventoryAddSheet visible={visible} onAdd={onAdd} onClose={onClose} />
  );

  act(() => {
    tree = create(sheet(true));
  });

  const close = () => act(() => tree.update(sheet(false)));
  // Closes the sheet and opens it again.
  const reopen = () => {
    close();
    act(() => tree.update(sheet(true)));
  };

  return { root: tree!.root, onAdd, onClose, close, reopen };
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

function getControl(root: ReactTestInstance, role: string, label: string): ReactTestInstance {
  const control = root
    .findAll(
      (node) => node.props.accessibilityRole === role && typeof node.props.onPress === 'function'
    )
    .find(
      (candidate) =>
        candidate.props.accessibilityLabel === label || getTexts(candidate).includes(label)
    );

  if (!control) {
    throw new Error(`No ${role} labelled "${label}"`);
  }

  return control;
}

function press(root: ReactTestInstance, label: string, role = 'button') {
  act(() => {
    getControl(root, role, label).props.onPress();
  });
}

// Presses and lets the write the press started settle.
async function pressAndSettle(root: ReactTestInstance, label: string) {
  await act(async () => {
    getControl(root, 'button', label).props.onPress();
  });
}

function getPanelMaxHeight(root: ReactTestInstance) {
  const panel = root.findAllByType(View).find((view) => view.props.accessibilityViewIsModal);

  return StyleSheet.flatten(panel?.props.style).maxHeight;
}

afterEach(() => {
  mockKeyboardLift = 0;
});

function fillRequiredFields(root: ReactTestInstance) {
  type(root, 'Nombre', 'Leche');
  type(root, 'Cantidad', '750');
}

describe('InventoryAddSheet', () => {
  it('starts empty, in grams and not a leftover', () => {
    const { root } = renderSheet();

    expect(getInput(root, 'Nombre').props.value).toBe('');
    expect(getInput(root, 'Cantidad').props.value).toBe('');
    expect(getInput(root, 'Vence').props.value).toBe('');
    expect(getInput(root, 'Notas').props.value).toBe('');
    expect(getControl(root, 'radio', 'Gramos').props.accessibilityState).toEqual({ checked: true });
    expect(getControl(root, 'radio', 'Mililitros').props.accessibilityState).toEqual({
      checked: false,
    });
    expect(getControl(root, 'checkbox', 'Es una sobra').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('adds the item by name with its quantity in thousandths and closes once the API took it', async () => {
    const { root, onAdd, onClose } = renderSheet();

    type(root, 'Nombre', '  Leche ');
    type(root, 'Cantidad', '1,5');
    await pressAndSettle(root, 'Agregar');

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toStrictEqual({
      ingredientName: 'Leche',
      quantityMilli: 1500,
      unit: 'g',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends the unit, the expiry as an ISO date, the notes and the leftover flag it was given', async () => {
    const { root, onAdd } = renderSheet();

    type(root, 'Nombre', 'Guiso de lentejas');
    type(root, 'Cantidad', '2');
    press(root, 'Unidades', 'radio');
    type(root, 'Vence', '12/10/2026');
    type(root, 'Notas', ' Del martes ');
    press(root, 'Es una sobra', 'checkbox');
    await pressAndSettle(root, 'Agregar');

    expect(onAdd.mock.calls[0][0]).toStrictEqual({
      ingredientName: 'Guiso de lentejas',
      quantityMilli: 2000,
      unit: 'unit',
      expiresAt: '2026-10-12',
      notes: 'Del martes',
      isLeftover: true,
    });
  });

  it('limits the notes to 500 characters', () => {
    const { root } = renderSheet();

    expect(getInput(root, 'Notas').props.maxLength).toBe(500);
  });

  it('sends at most 500 characters of notes, whatever reached the field', async () => {
    const { root, onAdd } = renderSheet();

    fillRequiredFields(root);
    // A paste can get past `maxLength` on some keyboards
    type(root, 'Notas', 'a'.repeat(600));
    await pressAndSettle(root, 'Agregar');

    expect(onAdd.mock.calls[0][0].notes).toBe('a'.repeat(500));
  });

  it('marks the unit it was last given as the chosen one', () => {
    const { root } = renderSheet();

    press(root, 'Mililitros', 'radio');

    expect(getControl(root, 'radio', 'Mililitros').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(getControl(root, 'radio', 'Gramos').props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('cannot be added until it has a name and a quantity', () => {
    const { root } = renderSheet();

    expect(getControl(root, 'button', 'Agregar').props.disabled).toBe(true);

    type(root, 'Nombre', 'Leche');

    expect(getControl(root, 'button', 'Agregar').props.disabled).toBe(true);

    type(root, 'Cantidad', '750');

    expect(getControl(root, 'button', 'Agregar').props.disabled).toBe(false);
  });

  it.each([
    ['a blank name', 'Nombre', '   '],
    ['a quantity of zero', 'Cantidad', '0'],
    ['a negative quantity', 'Cantidad', '-2'],
    ['a quantity that is not a number', 'Cantidad', 'dos'],
    ['an expiry that is not a date', 'Vence', '31/02/2027'],
  ])('does not send %s to the API', async (_label, field, text) => {
    const { root, onAdd } = renderSheet();

    fillRequiredFields(root);
    type(root, field, text);

    expect(getControl(root, 'button', 'Agregar').props.disabled).toBe(true);

    await pressAndSettle(root, 'Agregar');

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('stays open with the message of the error when the API rejects the item', async () => {
    const { root, onAdd, onClose } = renderSheet();
    onAdd.mockRejectedValueOnce(VALIDATION_ERROR);

    fillRequiredFields(root);
    await pressAndSettle(root, 'Agregar');

    const alert = root.find((node) => node.props.accessibilityRole === 'alert');

    expect(alert.props.children).toBe(VALIDATION_MESSAGE);
    expect(getTexts(root).join(' ')).not.toContain('validation_error');
    expect(onClose).not.toHaveBeenCalled();
    expect(getInput(root, 'Nombre').props.value).toBe('Leche');
  });

  it('keeps what it shows while it fades out and adds nothing from a late press', async () => {
    const { root, onAdd, close } = renderSheet();

    fillRequiredFields(root);
    close();

    expect(getInput(root, 'Nombre').props.value).toBe('Leche');

    await pressAndSettle(root, 'Agregar');

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('starts over when it is opened again', async () => {
    const { root, onAdd, reopen } = renderSheet();
    onAdd.mockRejectedValueOnce(VALIDATION_ERROR);

    fillRequiredFields(root);
    await pressAndSettle(root, 'Agregar');
    reopen();

    expect(getInput(root, 'Nombre').props.value).toBe('');
    expect(getTexts(root)).not.toContain(VALIDATION_MESSAGE);
  });

  it('is at most 85% of the window tall while the keyboard is closed', () => {
    const { root } = renderSheet();

    expect(getPanelMaxHeight(root)).toBeCloseTo(844 * 0.85);
  });

  it('fits between the status bar and the keyboard once the keyboard lifts it', () => {
    mockKeyboardLift = 336;

    const { root } = renderSheet();

    // The window is 844 tall and the status bar takes 47: the fields scroll in what is left.
    expect(getPanelMaxHeight(root)).toBe(844 - 336 - 47);
  });

  it('closes from the cancel action and from the backdrop without adding', () => {
    const { root, onAdd, onClose } = renderSheet();

    press(root, 'Cancelar');
    press(root, 'Cerrar');

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
