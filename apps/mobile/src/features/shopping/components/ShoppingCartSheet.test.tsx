/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { withOpacity } from '@/utils/colors';
import type { ShoppingCartLine } from '../types';
import { ShoppingCartSheet } from './ShoppingCartSheet';

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
  textMedium: '#bbbbbb',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

const CHICKEN: ShoppingCartLine = {
  id: 'i2:g',
  name: 'Pollo (Pechuga)',
  unit: 'g',
  quantityMilli: 1_200_000,
};

const NAPKINS: ShoppingCartLine = {
  id: 'manual-1',
  name: 'Servilletas',
  unit: 'unit',
  quantityMilli: 1_000,
};

const CART = [CHICKEN, NAPKINS];

const TITLE = 'Tu carrito';
const CONFIRM = 'Marcar como comprado';
const CANCEL = 'Cancelar';
const EMPTY_HINT = 'Todavía no marcaste nada.';
const CHICKEN_QUANTITY = 'Cantidad comprada, Pollo (Pechuga)';
const NAPKINS_QUANTITY = 'Cantidad comprada, Servilletas';

type SheetProps = React.ComponentProps<typeof ShoppingCartSheet>;

function renderSheet(initial: Partial<SheetProps> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  let props: SheetProps = {
    visible: true,
    lines: CART,
    isConfirming: false,
    onConfirm,
    onClose,
    ...initial,
  };
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<ShoppingCartSheet {...props} />);
  });

  const update = (next: Partial<SheetProps>) => {
    props = { ...props, ...next };
    act(() => {
      tree.update(<ShoppingCartSheet {...props} />);
    });
  };

  return { root: tree!.root, onConfirm, onClose, update };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getTextStyle(root: ReactTestInstance, text: string) {
  const [node] = root.findAllByType(Text).filter((candidate) => candidate.props.children === text);

  return StyleSheet.flatten(node.props.style);
}

function getButtons(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );
}

// A button by the text it shows, or by its label when it shows none.
function getButton(root: ReactTestInstance, name: string): ReactTestInstance {
  const button = getButtons(root).find(
    (candidate) => getTexts(candidate).includes(name) || candidate.props.accessibilityLabel === name
  );

  if (!button) {
    throw new Error(`No button named "${name}"`);
  }

  return button;
}

// Presses as a finger would: a disabled button takes no press.
function press(root: ReactTestInstance, name: string) {
  const button = getButton(root, name);

  act(() => {
    if (!button.props.disabled) button.props.onPress();
  });
}

function getQuantityInput(root: ReactTestInstance, label: string) {
  return root.findByProps({ accessibilityLabel: label, keyboardType: 'decimal-pad' });
}

function typeQuantity(root: ReactTestInstance, label: string, text: string) {
  act(() => {
    getQuantityInput(root, label).props.onChangeText(text);
  });
}

function getPanel(root: ReactTestInstance) {
  return root.findAllByType(View).find((view) => view.props.accessibilityViewIsModal)!;
}

describe('ShoppingCartSheet', () => {
  beforeEach(() => {
    mockKeepsChildrenWhileHidden = false;
  });

  it('lists the lines of the cart with what the Cart holds of each, between the title and the actions', () => {
    const { root } = renderSheet();

    expect(getTexts(root)).toEqual([
      TITLE,
      'Pollo (Pechuga)',
      'Sugerido: 1200 g',
      'g',
      'Servilletas',
      'Sugerido: 1 u',
      'u',
      CONFIRM,
      CANCEL,
    ]);
  });

  // A suggestion in kilos next to a field in grams would have a "2" typed for two kilos
  // bought as two grams.
  it('suggests each quantity as its field reads it, in the unit next to the field', () => {
    const rice: ShoppingCartLine = {
      id: 'i1:g',
      name: 'Arroz',
      unit: 'g',
      quantityMilli: 1_500_000,
    };
    const milk: ShoppingCartLine = {
      id: 'i3:ml',
      name: 'Leche',
      unit: 'ml',
      quantityMilli: 2_250_500,
    };
    const { root } = renderSheet({ lines: [rice, milk] });

    expect(getQuantityInput(root, 'Cantidad comprada, Arroz').props.value).toBe('1500');
    expect(getQuantityInput(root, 'Cantidad comprada, Leche').props.value).toBe('2250,5');
    expect(getTexts(root)).toEqual([
      TITLE,
      'Arroz',
      'Sugerido: 1500 g',
      'g',
      'Leche',
      'Sugerido: 2250,5 ml',
      'ml',
      CONFIRM,
      CANCEL,
    ]);
  });

  it('renders nothing while it is hidden', () => {
    const { root } = renderSheet({ visible: false });

    // A count, not the nodes: a failed assertion on a test instance prints its whole tree.
    expect(getTexts(root)).toEqual([]);
    expect(getButtons(root).length).toBe(0);
  });

  it('reads each line as one element, with what the Cart holds of it', () => {
    const { root } = renderSheet();
    const rows = root
      .findAllByType(View)
      .filter((view) => view.props.accessible === true && !view.props.accessibilityRole)
      .map((view) => view.props.accessibilityLabel);

    expect(rows).toEqual(['Pollo (Pechuga), Sugerido: 1200 g', 'Servilletas, Sugerido: 1 u']);
  });

  it('scrolls the rows inside a height bounded by the window', () => {
    const { root } = renderSheet();
    const { maxHeight } = StyleSheet.flatten(root.findByType(ScrollView).props.style);

    // The Jest window is 1334 pt tall.
    expect(maxHeight).toBe(Math.round(1334 * 0.4));
  });

  it('rises with the keyboard, which the quantity fields open', () => {
    const { root } = renderSheet();

    expect(StyleSheet.flatten(getPanel(root).props.style)).toEqual(
      expect.objectContaining(mockKeyboardLift)
    );
    expect(useKeyboardAnimation).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, bottomInset: 34 })
    );
  });

  describe('the bought quantity', () => {
    it('starts at what the Cart holds, in the unit of the line, in a field named after it', () => {
      const { root } = renderSheet();

      expect(getQuantityInput(root, CHICKEN_QUANTITY).props.value).toBe('1200');
      expect(getQuantityInput(root, NAPKINS_QUANTITY).props.value).toBe('1');
      expect(root.findAllByType(TextInput).map((input) => input.props.testID)).toEqual([
        'shopping-cart-quantity-i2:g',
        'shopping-cart-quantity-manual-1',
      ]);
    });

    it('writes the decimals of a quantity after a comma', () => {
      const { root } = renderSheet({ lines: [{ ...NAPKINS, quantityMilli: 2_500 }] });

      expect(getQuantityInput(root, NAPKINS_QUANTITY).props.value).toBe('2,5');
    });

    it('confirms with no line while nothing was adjusted', () => {
      const { root, onConfirm } = renderSheet();

      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledWith([]);
    });

    it('confirms with only the line that was adjusted, by its id, in thousandths', () => {
      const { root, onConfirm } = renderSheet();

      typeQuantity(root, CHICKEN_QUANTITY, '950,5');
      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledWith([{ itemId: 'i2:g', quantityMilli: 950_500 }]);
    });

    it('takes more than what the Cart holds, and none at all', () => {
      const { root, onConfirm } = renderSheet();

      typeQuantity(root, CHICKEN_QUANTITY, '1500');
      typeQuantity(root, NAPKINS_QUANTITY, '0');
      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledWith([
        { itemId: 'i2:g', quantityMilli: 1_500_000 },
        { itemId: 'manual-1', quantityMilli: 0 },
      ]);
    });

    it('leaves out a line typed back to what the Cart holds', () => {
      const { root, onConfirm } = renderSheet();

      typeQuantity(root, CHICKEN_QUANTITY, '800');
      typeQuantity(root, CHICKEN_QUANTITY, '1200,0');
      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledWith([]);
    });

    it.each(['', 'abc', '-1', '1,2,3'])('cannot be confirmed while a field reads "%s"', (text) => {
      const { root, onConfirm } = renderSheet();

      typeQuantity(root, NAPKINS_QUANTITY, text);

      expect(getButton(root, CONFIRM).props.disabled).toBe(true);
      expect(getButton(root, CONFIRM).props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true })
      );
      press(root, CONFIRM);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('starts again from what the Cart holds every time it is opened', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, update } = renderSheet();
      typeQuantity(root, CHICKEN_QUANTITY, '800');

      update({ visible: false });
      // Kept while it fades out: the field does not jump back under the finger.
      expect(getQuantityInput(root, CHICKEN_QUANTITY).props.value).toBe('800');

      update({ visible: true });
      expect(getQuantityInput(root, CHICKEN_QUANTITY).props.value).toBe('1200');
    });
  });

  describe('with an empty cart', () => {
    it('says nothing was marked instead of listing rows', () => {
      const { root } = renderSheet({ lines: [] });

      expect(getTexts(root)).toEqual([TITLE, EMPTY_HINT, CONFIRM, CANCEL]);
      expect(root.findAllByType(ScrollView)).toHaveLength(0);
    });

    it('keeps "Marcar como comprado" disabled, so a press confirms nothing', () => {
      const { root, onConfirm } = renderSheet({ lines: [] });

      expect(getButton(root, CONFIRM).props.disabled).toBe(true);
      press(root, CONFIRM);

      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('confirming', () => {
    it('asks for the purchase and stays open: the screen closes it once the server answers', () => {
      const { root, onConfirm, onClose } = renderSheet();
      const confirmButton = getButton(root, CONFIRM);

      expect(confirmButton.props.disabled).toBe(false);
      expect(confirmButton.props.accessibilityState).toEqual({ disabled: false, busy: false });

      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('cannot be asked again while the purchase is on its way', () => {
      const { root, onConfirm, update } = renderSheet();
      press(root, CONFIRM);

      update({ isConfirming: true });

      expect(getButton(root, CONFIRM).props.disabled).toBe(true);
      expect(getButton(root, CONFIRM).props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      });
      expect(root.findAllByType(TextInput).map((input) => input.props.editable)).toEqual([
        false,
        false,
      ]);
      press(root, CONFIRM);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('can be asked again once a refused purchase is answered', () => {
      const { root, onConfirm, update } = renderSheet();
      press(root, CONFIRM);
      update({ isConfirming: true });

      update({ isConfirming: false, errorMessage: 'Otro integrante ya los tiene.' });
      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it('says why the purchase was refused, as an alert above the actions, and keeps the quantities', () => {
      const { root, update } = renderSheet();
      typeQuantity(root, CHICKEN_QUANTITY, '800');

      update({ errorMessage: 'Otro integrante ya los tiene.' });

      const [alert] = root.findAll(
        (node) => node.props.accessibilityRole === 'alert' && typeof node.type === 'string'
      );
      expect(alert.props.children).toBe('Otro integrante ya los tiene.');
      expect(getTexts(root).slice(-3)).toEqual(['Otro integrante ya los tiene.', CONFIRM, CANCEL]);
      expect(getQuantityInput(root, CHICKEN_QUANTITY).props.value).toBe('800');
    });

    it('keeps showing the bought lines while it fades out, instead of the empty hint', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, update } = renderSheet();
      const textsWhileOpen = getTexts(root);
      press(root, CONFIRM);

      // The purchase emptied the cart and the screen asked the sheet to close.
      update({ visible: false, lines: [] });

      expect(getTexts(root)).toEqual(textsWhileOpen);
    });

    it('confirms nothing from a press that lands while it fades out', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, onConfirm, update } = renderSheet();
      press(root, CANCEL);
      update({ visible: false });

      press(root, CONFIRM);

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('follows the cart while it is open, and lists the one it is reopened with', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, update } = renderSheet();

      update({ lines: [NAPKINS] });
      expect(getTexts(root)).toEqual([TITLE, 'Servilletas', 'Sugerido: 1 u', 'u', CONFIRM, CANCEL]);

      update({ visible: false, lines: [] });
      update({ visible: true, lines: [CHICKEN] });
      expect(getTexts(root)).toEqual([
        TITLE,
        'Pollo (Pechuga)',
        'Sugerido: 1200 g',
        'g',
        CONFIRM,
        CANCEL,
      ]);
    });
  });

  it.each([CANCEL, 'Cerrar'])('closes from "%s" without confirming', (name) => {
    const { root, onConfirm, onClose } = renderSheet();

    press(root, name);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rests on the bottom edge, clear of the home indicator', () => {
    const { root } = renderSheet();

    expect(StyleSheet.flatten(getPanel(root).props.style).paddingBottom).toBe(34 + 16);
  });

  it('takes every color from the palette, by the roles of a dark surface', () => {
    const { root } = renderSheet({ errorMessage: 'No se pudo.' });
    const [confirmSurface] = getButton(root, CONFIRM).findAllByType(View);
    const input = StyleSheet.flatten(getQuantityInput(root, CHICKEN_QUANTITY).props.style);

    expect(StyleSheet.flatten(getPanel(root).props.style).backgroundColor).toBe(
      mockTheme.colorDark
    );
    expect(getTextStyle(root, TITLE).color).toBe(mockTheme.textLight);
    expect(getTextStyle(root, 'Pollo (Pechuga)').color).toBe(mockTheme.textLight);
    expect(getTextStyle(root, 'Sugerido: 1200 g').color).toBe(mockTheme.textMedium);
    expect(getTextStyle(root, 'g').color).toBe(mockTheme.textMedium);
    expect(getTextStyle(root, 'No se pudo.').color).toBe(mockTheme.textLight);
    expect(input).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.icon, 0.15),
        borderColor: withOpacity(mockTheme.icon, 0.3),
        color: mockTheme.textLight,
      })
    );
    expect(StyleSheet.flatten(confirmSurface.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: mockTheme.primaryAccent,
        borderColor: mockTheme.primaryAccentIntense,
      })
    );
    expect(getTextStyle(root, CONFIRM).color).toBe(mockTheme.textBlack);
    expect(getTextStyle(root, CANCEL).color).toBe(mockTheme.textLight);
  });

  it('mutes the empty hint with the light text of the panel', () => {
    const { root } = renderSheet({ lines: [] });

    expect(getTextStyle(root, EMPTY_HINT).color).toBe(withOpacity(mockTheme.textLight, 0.6));
  });
});
