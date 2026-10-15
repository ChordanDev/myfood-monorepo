/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { MILK as MILK_LOT } from '../fixtures';
import type { InventoryItem } from '../types';
import { InventoryEditSheet } from './InventoryEditSheet';

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
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return { __esModule: true, default: { View } };
});

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({
    inputAnimatedStyle: {},
    isKeyboardOpen: false,
    keyboardLift: 0,
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

const MILK: InventoryItem = {
  ...MILK_LOT,
  name: 'Leche entera',
  quantityMilli: 1_000_000,
  notes: null,
};

const VALIDATION_ERROR = new ApiError('validation_error', 'The request data is not valid.', 422);
const VALIDATION_MESSAGE = 'Los datos ingresados no son válidos.';

// A write the test settles by hand, to look at the sheet while it is on its way.
function deferredWrite() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderSheet(item: InventoryItem = MILK) {
  const onSetQuantity = jest.fn((_itemId: string, _quantityMilli: number) => Promise.resolve());
  const onDispose = jest.fn((_itemId: string) => Promise.resolve());
  const onClose = jest.fn();
  let tree: ReturnType<typeof create>;

  const sheet = (visible: boolean) => (
    <InventoryEditSheet
      visible={visible}
      item={item}
      onSetQuantity={onSetQuantity}
      onDispose={onDispose}
      onClose={onClose}
    />
  );

  act(() => {
    tree = create(sheet(true));
  });

  const close = () => act(() => tree.update(sheet(false)));
  // Closes the sheet and opens it again on the same item.
  const reopen = () => {
    close();
    act(() => tree.update(sheet(true)));
  };

  return { root: tree!.root, onSetQuantity, onDispose, onClose, close, reopen };
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

// Presses and lets the write the press started settle.
async function pressAndSettle(root: ReactTestInstance, label: string) {
  await act(async () => {
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

  it('clamps long notes to three lines, so they never push the actions off screen', () => {
    const notes = 'Del domingo. '.repeat(80);
    const { root } = renderSheet({ ...MILK, notes });

    const subtitle = root.findAllByType(Text).find((node) => node.props.children === notes);

    expect(subtitle?.props.numberOfLines).toBe(3);
    expect(subtitle?.props.ellipsizeMode).toBe('tail');
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

  it('sets the typed quantity in thousandths and closes once the API took it', async () => {
    const { root, onSetQuantity, onClose } = renderSheet();

    type(root, 'Cantidad', '1,5');
    await pressAndSettle(root, 'Guardar');

    expect(onSetQuantity).toHaveBeenCalledTimes(1);
    expect(onSetQuantity).toHaveBeenCalledWith(MILK.id, 1500);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sets zero, which empties the lot', async () => {
    const { root, onSetQuantity } = renderSheet();

    type(root, 'Cantidad', '0');
    await pressAndSettle(root, 'Guardar');

    expect(onSetQuantity).toHaveBeenCalledWith(MILK.id, 0);
  });

  it.each(['', 'abc', '-1', '1.000,5'])(
    'does not send the quantity "%s" to the API',
    async (quantity) => {
      const { root, onSetQuantity } = renderSheet();

      type(root, 'Cantidad', quantity);

      expect(getButton(root, 'Guardar').props.disabled).toBe(true);

      await pressAndSettle(root, 'Guardar');

      expect(onSetQuantity).not.toHaveBeenCalled();
    }
  );

  it('can be saved again once the quantity is valid', () => {
    const { root } = renderSheet();

    type(root, 'Cantidad', 'abc');
    type(root, 'Cantidad', '750');

    expect(getButton(root, 'Guardar').props.disabled).toBe(false);
  });

  it('is busy while the write is on its way and takes no second one', async () => {
    const write = deferredWrite();
    const { root, onSetQuantity, onDispose, onClose } = renderSheet();
    onSetQuantity.mockReturnValueOnce(write.promise);

    press(root, 'Guardar');

    expect(getTexts(root)).toContain('Guardando…');
    expect(getButton(root, 'Guardando…').props.disabled).toBe(true);
    expect(getButton(root, 'Borrar del inventario').props.disabled).toBe(true);
    expect(getButton(root, 'Cancelar').props.disabled).toBe(true);

    press(root, 'Guardando…');
    press(root, 'Borrar del inventario');
    press(root, 'Cerrar');

    expect(onSetQuantity).toHaveBeenCalledTimes(1);
    expect(onDispose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open with the message of the error when the API rejects the quantity', async () => {
    const { root, onSetQuantity, onClose } = renderSheet();
    onSetQuantity.mockRejectedValueOnce(VALIDATION_ERROR);

    await pressAndSettle(root, 'Guardar');

    const alert = root.find((node) => node.props.accessibilityRole === 'alert');

    expect(alert.props.children).toBe(VALIDATION_MESSAGE);
    expect(getTexts(root).join(' ')).not.toContain('validation_error');
    expect(onClose).not.toHaveBeenCalled();
    expect(getButton(root, 'Guardar').props.disabled).toBe(false);
  });

  it('clears the message when the write is tried again', async () => {
    const { root, onSetQuantity, onClose } = renderSheet();
    onSetQuantity.mockRejectedValueOnce(VALIDATION_ERROR);

    await pressAndSettle(root, 'Guardar');
    await pressAndSettle(root, 'Guardar');

    expect(getTexts(root)).not.toContain(VALIDATION_MESSAGE);
    expect(onSetQuantity).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disposes of the lot and closes once the API took it', async () => {
    const { root, onDispose, onSetQuantity, onClose } = renderSheet();

    await pressAndSettle(root, 'Borrar del inventario');

    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledWith(MILK.id);
    expect(onSetQuantity).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open with the message of the error when the lot cannot be disposed of', async () => {
    const { root, onDispose, onClose } = renderSheet();
    onDispose.mockRejectedValueOnce(
      new ApiError('inventory_item_not_found', 'Inventory item not found', 404)
    );

    await pressAndSettle(root, 'Borrar del inventario');

    expect(getTexts(root)).toContain('No encontramos ese producto en tu inventario.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps what it shows while it fades out and takes no write from a late press', async () => {
    const { root, onSetQuantity, onDispose, close } = renderSheet();

    type(root, 'Cantidad', '999');
    close();

    expect(getInput(root, 'Cantidad').props.value).toBe('999');

    await pressAndSettle(root, 'Guardar');
    await pressAndSettle(root, 'Borrar del inventario');

    expect(onSetQuantity).not.toHaveBeenCalled();
    expect(onDispose).not.toHaveBeenCalled();
  });

  it('starts over when it is opened again: no typed text, no error', async () => {
    const { root, onSetQuantity, reopen } = renderSheet();
    onSetQuantity.mockRejectedValueOnce(VALIDATION_ERROR);

    type(root, 'Cantidad', '999');
    await pressAndSettle(root, 'Guardar');
    reopen();

    expect(getInput(root, 'Cantidad').props.value).toBe('1000');
    expect(getTexts(root)).not.toContain(VALIDATION_MESSAGE);
  });

  it('closes from the cancel action and from the backdrop without writing', () => {
    const { root, onSetQuantity, onDispose, onClose } = renderSheet();

    press(root, 'Cancelar');
    press(root, 'Cerrar');

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSetQuantity).not.toHaveBeenCalled();
    expect(onDispose).not.toHaveBeenCalled();
  });
});
