/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { LeftoverAddSheet } from './LeftoverAddSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: true }),
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
    },
  }),
}));

function renderSheet(onAdd: jest.Mock = jest.fn(() => Promise.resolve())) {
  const onClose = jest.fn();
  const sheet = (visible: boolean) => (
    <LeftoverAddSheet visible={visible} onAdd={onAdd} onClose={onClose} />
  );
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(sheet(true));
  });

  const setVisible = (visible: boolean) => {
    act(() => {
      tree.update(sheet(visible));
    });
  };

  return { root: tree!.root, onAdd, onClose, setVisible };
}

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => String(node.props.children));
}

function input(root: ReactTestInstance, label: string): ReactTestInstance {
  return root
    .findAllByType(TextInput)
    .find((candidate) => candidate.props.accessibilityLabel === label)!;
}

function type(root: ReactTestInstance, label: string, text: string) {
  act(() => {
    input(root, label).props.onChangeText(text);
  });
}

function saveButton(root: ReactTestInstance): ReactTestInstance {
  return root.find(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      texts(node).some((text) => text === 'Guardar' || text === 'Guardando…')
  );
}

async function save(root: ReactTestInstance) {
  await act(async () => {
    saveButton(root).props.onPress();
  });
}

describe('LeftoverAddSheet', () => {
  it('cannot save until the title is filled and the portions are a whole number from 1 to 1000', () => {
    const { root } = renderSheet();

    expect(saveButton(root).props.disabled).toBe(true);

    type(root, 'Nombre de la sobra', '  Lentil stew ');
    expect(saveButton(root).props.disabled).toBe(false);

    for (const portions of ['0', '1001', '2.5', '', 'two']) {
      type(root, 'Porciones', portions);
      expect(saveButton(root).props.disabled).toBe(true);
    }

    type(root, 'Porciones', '1000');
    expect(saveButton(root).props.disabled).toBe(false);
  });

  it('stores the trimmed fields without notes when they are blank, then closes', async () => {
    const { root, onAdd, onClose } = renderSheet();

    type(root, 'Nombre de la sobra', '  Lentil stew ');
    type(root, 'Porciones', ' 3 ');
    type(root, 'Notas', '   ');
    await save(root);

    expect(onAdd).toHaveBeenCalledWith({ title: 'Lentil stew', portions: 3 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends the notes and caps them at 500 characters', async () => {
    const { root, onAdd } = renderSheet();

    expect(input(root, 'Notas').props.maxLength).toBe(500);
    expect(input(root, 'Nombre de la sobra').props.maxLength).toBe(255);

    type(root, 'Nombre de la sobra', 'Rice');
    type(root, 'Notas', ' In the blue container ');
    await save(root);

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Rice',
      portions: 1,
      notes: 'In the blue container',
    });
  });

  it('stays open with the error when the server refuses, and saves on retry', async () => {
    const onAdd = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('validation_error', 'Invalid notes'))
      .mockResolvedValueOnce(undefined);
    const { root, onClose } = renderSheet(onAdd);

    type(root, 'Nombre de la sobra', 'Rice');
    await save(root);

    expect(onClose).not.toHaveBeenCalled();
    expect(root.findAll((node) => node.props.accessibilityRole === 'alert')).not.toHaveLength(0);

    await save(root);

    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends one leftover when save is pressed again while the first is on its way', async () => {
    let finish: () => void = () => {};
    const onAdd = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { root, onClose } = renderSheet(onAdd);

    type(root, 'Nombre de la sobra', 'Rice');
    const button = saveButton(root);
    act(() => {
      button.props.onPress();
      button.props.onPress();
    });

    expect(texts(root)).toContain('Guardando…');

    // Closing waits for the write.
    act(() => {
      root
        .find((node) => node.props.accessibilityLabel === 'Cerrar' && node.props.onPress)
        .props.onPress();
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finish());

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts empty every time it opens', () => {
    const { root, setVisible } = renderSheet();

    type(root, 'Nombre de la sobra', 'Rice');
    type(root, 'Porciones', '4');
    setVisible(false);
    setVisible(true);

    expect(input(root, 'Nombre de la sobra').props.value).toBe('');
    expect(input(root, 'Porciones').props.value).toBe('1');
  });
});
