/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { withOpacity } from '@/utils/colors';
import { ShoppingAddItemSheet } from './ShoppingAddItemSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

// iOS keeps the children of a modal mounted while it fades out; the stock Jest mock drops
// them at once. A test turns this on to press what is still on screen during that fade.
let mockKeepsChildrenWhileHidden = false;

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible || mockKeepsChildrenWhileHidden ? children : null,
}));

const mockKeyboardLift = { transform: [{ translateY: -300 }] };

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: jest.fn(() => ({
    inputAnimatedStyle: mockKeyboardLift,
    isKeyboardOpen: true,
  })),
}));

const mockTheme = {
  colorDark: '#111111',
  icon: '#cccccc',
  primaryAccent: '#ff6600',
  primaryAccentIntense: '#ff3300',
  textBlack: '#000000',
  textLight: '#eeeeee',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

function renderSheet(visible = true) {
  const onAdd = jest.fn();
  const onClose = jest.fn();
  const sheet = (isVisible: boolean) => (
    <ShoppingAddItemSheet visible={isVisible} onAdd={onAdd} onClose={onClose} />
  );
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(sheet(visible));
  });

  const setVisible = (isVisible: boolean) => {
    act(() => {
      tree.update(sheet(isVisible));
    });
  };

  return { root: tree!.root, onAdd, onClose, setVisible };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getButtons(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );
}

// A button by the text it shows, or by its label when it shows none (the backdrop).
function getButton(root: ReactTestInstance, name: string): ReactTestInstance {
  const button = getButtons(root).find(
    (candidate) => getTexts(candidate).includes(name) || candidate.props.accessibilityLabel === name
  );

  if (!button) {
    throw new Error(`No button named "${name}"`);
  }

  return button;
}

function press(root: ReactTestInstance, name: string) {
  act(() => {
    getButton(root, name).props.onPress();
  });
}

function getInput(root: ReactTestInstance) {
  return root.findByType(TextInput);
}

function typeName(root: ReactTestInstance, name: string) {
  act(() => {
    getInput(root).props.onChangeText(name);
  });
}

function submitFromKeyboard(root: ReactTestInstance) {
  act(() => {
    getInput(root).props.onSubmitEditing();
  });
}

describe('ShoppingAddItemSheet', () => {
  beforeEach(() => {
    jest.mocked(useKeyboardAnimation).mockClear();
    mockKeepsChildrenWhileHidden = false;
  });

  it('asks for a name, with an add and a cancel action', () => {
    const { root } = renderSheet();

    expect(getTexts(root)).toEqual(['¿Qué querés agregar?', 'Agregar', 'Cancelar']);
    expect(getInput(root).props).toEqual(
      expect.objectContaining({
        accessibilityLabel: 'Nombre del producto',
        placeholder: 'Ej.: papel de cocina',
        value: '',
      })
    );
  });

  it('renders nothing while it is hidden', () => {
    const { root } = renderSheet(false);

    // A count, not the nodes: a failed assertion on a test instance prints its whole tree.
    expect(root.findAllByType(TextInput).length).toBe(0);
    expect(getTexts(root)).toEqual([]);
  });

  it('takes a single line, focused on open, that submits from the return key', () => {
    const { root } = renderSheet();
    const { props } = getInput(root);

    expect(props.autoFocus).toBe(true);
    expect(props.returnKeyType).toBe('done');
    expect(props.multiline).toBeFalsy();
  });

  it.each(['', '   '])('keeps "Agregar" disabled while the name is "%s"', (name) => {
    const { root, onAdd, onClose } = renderSheet();
    typeName(root, name);
    const addButton = getButton(root, 'Agregar');

    expect(addButton.props.disabled).toBe(true);
    expect(addButton.props.accessibilityState).toEqual({ disabled: true });

    // Neither path adds: the button is disabled, and the return key is not.
    press(root, 'Agregar');
    submitFromKeyboard(root);

    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('adds the trimmed name from the button and closes', () => {
    const { root, onAdd, onClose } = renderSheet();
    typeName(root, '  Papel de cocina ');
    const addButton = getButton(root, 'Agregar');

    expect(addButton.props.disabled).toBe(false);
    expect(addButton.props.accessibilityState).toEqual({ disabled: false });

    press(root, 'Agregar');

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Papel de cocina');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('adds the name from the return key and closes', () => {
    const { root, onAdd, onClose } = renderSheet();
    typeName(root, 'Velas');

    submitFromKeyboard(root);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Velas');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['Cancelar', 'Cerrar'])('closes from "%s" without adding what was typed', (name) => {
    const { root, onAdd, onClose } = renderSheet();
    typeName(root, 'Velas');

    press(root, name);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it.each(['Agregar', 'Cancelar'])('opens empty again after "%s"', (name) => {
    const { root, setVisible } = renderSheet();
    typeName(root, 'Velas');
    press(root, name);
    setVisible(false);

    setVisible(true);

    expect(getInput(root).props.value).toBe('');
    expect(getButton(root, 'Agregar').props.disabled).toBe(true);
  });

  it('lifts the panel above the keyboard only while it is open', () => {
    const { root, setVisible } = renderSheet();
    const panel = root.findAllByType(View).find((view) => view.props.accessibilityViewIsModal);

    expect(useKeyboardAnimation).toHaveBeenLastCalledWith({
      mode: 'geometry',
      restingBottomOffset: 0,
      bottomInset: 34,
      enabled: true,
    });
    expect(StyleSheet.flatten(panel!.props.style)).toEqual(
      expect.objectContaining({ ...mockKeyboardLift, paddingBottom: 34 + 16 })
    );

    setVisible(false);

    expect(useKeyboardAnimation).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('takes every color from the palette, by role', () => {
    const { root } = renderSheet();
    typeName(root, 'Velas');
    const panel = root.findAllByType(View).find((view) => view.props.accessibilityViewIsModal);
    const input = getInput(root);
    const [addButton] = getButton(root, 'Agregar').findAllByType(View);

    expect(StyleSheet.flatten(panel!.props.style).backgroundColor).toBe(mockTheme.colorDark);
    expect(input.props.placeholderTextColor).toBe(withOpacity(mockTheme.textLight, 0.6));
    expect(input.props.selectionColor).toBe(mockTheme.primaryAccent);
    expect(StyleSheet.flatten(input.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.icon, 0.15),
        borderColor: withOpacity(mockTheme.icon, 0.3),
        color: mockTheme.textLight,
      })
    );
    expect(StyleSheet.flatten(addButton.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: mockTheme.primaryAccent,
        borderColor: mockTheme.primaryAccentIntense,
      })
    );
  });

  describe('adding at most once per opening', () => {
    it('adds once when the return key is pressed twice', () => {
      const { root, onAdd, onClose } = renderSheet();
      typeName(root, 'Velas');

      submitFromKeyboard(root);
      submitFromKeyboard(root);

      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('adds once when the return key is followed by "Agregar"', () => {
      const { root, onAdd, onClose } = renderSheet();
      typeName(root, 'Velas');

      submitFromKeyboard(root);
      press(root, 'Agregar');

      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('adds once when the second submit lands while it fades out', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, onAdd, setVisible } = renderSheet();
      typeName(root, 'Velas');
      submitFromKeyboard(root);
      setVisible(false);

      submitFromKeyboard(root);
      press(root, 'Agregar');

      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('adds nothing from a submit that lands while it fades out after a cancel', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, onAdd, setVisible } = renderSheet();
      typeName(root, 'Velas');
      press(root, 'Cancelar');
      setVisible(false);

      submitFromKeyboard(root);
      press(root, 'Agregar');

      expect(onAdd).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'adds again once it is reopened (children kept while hidden: %s)',
      (keepsChildren) => {
        mockKeepsChildrenWhileHidden = keepsChildren;
        const { root, onAdd, setVisible } = renderSheet();
        typeName(root, 'Velas');
        submitFromKeyboard(root);
        setVisible(false);

        setVisible(true);
        typeName(root, 'Hielo');
        submitFromKeyboard(root);
        submitFromKeyboard(root);

        expect(onAdd.mock.calls).toEqual([['Velas'], ['Hielo']]);
      }
    );
  });
});
