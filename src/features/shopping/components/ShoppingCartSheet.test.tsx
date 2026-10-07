import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import { withOpacity } from '@/utils/colors';
import type { BestOffer, ShoppingListItem } from '../types';
import { ShoppingCartSheet } from './ShoppingCartSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

// iOS keeps the children of a modal mounted while it fades out; the stock Jest mock drops
// them at once. A test turns this on to press what is still on screen during that fade.
let mockKeepsChildrenWhileHidden = false;

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible || mockKeepsChildrenWhileHidden ? children : null,
}));

jest.mock('lucide-react-native', () => ({ X: 'X' }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
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

const CHICKEN: ShoppingListItem = {
  id: 'planned:i2',
  source: 'planned_meal',
  status: 'in_cart',
  name: 'Pollo (Pechuga)',
  ingredientId: 'i2',
  amountToBuy: 200,
  unit: 'gramos',
  category: 'proteinas',
};

const NAPKINS: ShoppingListItem = {
  id: 'manual:1',
  source: 'manual',
  status: 'in_cart',
  name: 'Servilletas',
};

const CART = [CHICKEN, NAPKINS];

const BEST_OFFERS: Record<string, BestOffer> = {
  'planned:i2': { supermarket: 'Día', unitPrice: 7.6, price: 1520 },
};

const TITLE = 'Tu carrito';
const CONFIRM = 'Marcar como comprado';
const CANCEL = 'Cancelar';
const EMPTY_HINT = 'Todavía no marcaste nada.';
const TAKE_OUT_CHICKEN = 'Sacar del carrito, 200 g · Pollo (Pechuga)';
const TAKE_OUT_NAPKINS = 'Sacar del carrito, Servilletas';

function renderSheet(initialItems: ShoppingListItem[] = CART, initiallyVisible = true) {
  const onTakeOut = jest.fn();
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  let items = initialItems;
  let bestOffers = BEST_OFFERS;
  let visible = initiallyVisible;
  const sheet = () => (
    <ShoppingCartSheet
      visible={visible}
      items={items}
      bestOffers={bestOffers}
      onTakeOut={onTakeOut}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(sheet());
  });

  const update = (next: {
    visible?: boolean;
    items?: ShoppingListItem[];
    bestOffers?: Record<string, BestOffer>;
  }) => {
    visible = next.visible ?? visible;
    items = next.items ?? items;
    bestOffers = next.bestOffers ?? bestOffers;
    act(() => {
      tree.update(sheet());
    });
  };

  return { root: tree!.root, onTakeOut, onConfirm, onClose, update };
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

function press(root: ReactTestInstance, name: string) {
  act(() => {
    getButton(root, name).props.onPress();
  });
}

// How far a style pushes its view past the right edge of its parent.
function getRightOutdent(style: unknown) {
  const { margin, marginEnd, marginHorizontal, marginRight, right } = (StyleSheet.flatten(
    style as never
  ) ?? {}) as Record<string, number | undefined>;

  return Math.max(0, -(marginRight ?? marginEnd ?? marginHorizontal ?? margin ?? 0), -(right ?? 0));
}

function getTypeName({ type }: ReactTestInstance) {
  return typeof type === 'string' ? type : (type as { displayName?: string }).displayName;
}

// Outdent of everything between a node and the scrolling list it is in, the node included.
// The list clips: whatever sticks out of it cannot be touched. The walk stops at the native
// scroll view, which carries the style of the list itself.
function getOutdentInsideList(root: ReactTestInstance, node: ReactTestInstance) {
  let outdent = getRightOutdent(root.findByType(ScrollView).props.contentContainerStyle);
  let current: ReactTestInstance | null = node;

  while (current && getTypeName(current) !== 'RCTScrollView') {
    const { style } = current.props;
    outdent += getRightOutdent(typeof style === 'function' ? style({ pressed: false }) : style);
    current = current.parent;
  }

  if (!current) {
    throw new Error('The node is not inside a scrolling list');
  }

  return outdent;
}

function getPanel(root: ReactTestInstance) {
  return root.findAllByType(View).find((view) => view.props.accessibilityViewIsModal)!;
}

describe('ShoppingCartSheet', () => {
  beforeEach(() => {
    jest.mocked(Haptics.impactAsync).mockClear();
    jest.mocked(Haptics.notificationAsync).mockClear();
    mockKeepsChildrenWhileHidden = false;
  });

  it('lists the rows of the cart, planned and manual, between the title and the actions', () => {
    const { root } = renderSheet();

    expect(getTexts(root)).toEqual([
      TITLE,
      '200 g · Pollo (Pechuga)',
      'Día · $1.520',
      'Servilletas',
      'Sin precio',
      CONFIRM,
      CANCEL,
    ]);
  });

  it('renders nothing while it is hidden', () => {
    const { root } = renderSheet(CART, false);

    // A count, not the nodes: a failed assertion on a test instance prints its whole tree.
    expect(getTexts(root)).toEqual([]);
    expect(getButtons(root).length).toBe(0);
  });

  it('reads each row as one element, with both of its lines', () => {
    const { root } = renderSheet();
    const rows = root
      .findAllByType(View)
      .filter((view) => view.props.accessible === true && !view.props.accessibilityRole)
      .map((view) => view.props.accessibilityLabel);

    expect(rows).toEqual(['200 g · Pollo (Pechuga), Día · $1.520', 'Servilletas, Sin precio']);
  });

  it('scrolls the rows inside a height bounded by the window', () => {
    const { root } = renderSheet();
    const { maxHeight } = StyleSheet.flatten(root.findByType(ScrollView).props.style);

    // The Jest window is 1334 pt tall.
    expect(maxHeight).toBe(Math.round(1334 * 0.4));
  });

  describe('taking a row out', () => {
    it('offers it on every row, named after the row', () => {
      const { root } = renderSheet();

      expect(getButtons(root).map((button) => button.props.accessibilityLabel)).toEqual([
        'Cerrar',
        TAKE_OUT_CHICKEN,
        TAKE_OUT_NAPKINS,
        undefined,
        undefined,
      ]);
    });

    it('reports the id of the row, with a light haptic, and neither confirms nor closes', () => {
      const { root, onTakeOut, onConfirm, onClose } = renderSheet();

      press(root, TAKE_OUT_NAPKINS);

      expect(onTakeOut).toHaveBeenCalledTimes(1);
      expect(onTakeOut).toHaveBeenCalledWith('manual:1');
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('is a touch target of at least 44 pt that lies whole inside the scrolling list', () => {
      const { root } = renderSheet();
      const button = getButton(root, TAKE_OUT_CHICKEN);
      const [target] = button.findAllByType(View);
      const { height, width } = StyleSheet.flatten(target.props.style);

      expect(height).toBeGreaterThanOrEqual(44);
      expect(width).toBeGreaterThanOrEqual(44);
      // Any part of it past the right edge of the list would be clipped away.
      expect(getOutdentInsideList(root, button)).toBe(0);
    });

    it('lines the icon up with the padding of the panel by widening the list, inside the panel', () => {
      const { root } = renderSheet();
      const [target] = getButton(root, TAKE_OUT_CHICKEN).findAllByType(View);
      const [icon] = root.findAllByType(X);
      const listOutdent = getRightOutdent(root.findByType(ScrollView).props.style);
      const { paddingHorizontal } = StyleSheet.flatten(getPanel(root).props.style);

      // The icon is centred in its target: the list reaches out by the space beside it.
      expect(listOutdent).toBe(
        (StyleSheet.flatten(target.props.style).width - icon.props.size) / 2
      );
      expect(listOutdent).toBeLessThanOrEqual(paddingHorizontal);
    });

    it('stops listing a row once it is out of the cart', () => {
      const { root, update } = renderSheet();

      update({ items: [CHICKEN] });

      expect(getTexts(root)).toEqual([
        TITLE,
        '200 g · Pollo (Pechuga)',
        'Día · $1.520',
        CONFIRM,
        CANCEL,
      ]);
    });
  });

  describe('with an empty cart', () => {
    it('says nothing was marked instead of listing rows', () => {
      const { root } = renderSheet([]);

      expect(getTexts(root)).toEqual([TITLE, EMPTY_HINT, CONFIRM, CANCEL]);
      expect(root.findAllByType(ScrollView).length).toBe(0);
    });

    it('keeps "Marcar como comprado" disabled, so a press confirms nothing', () => {
      const { root, onConfirm, onClose } = renderSheet([]);
      const confirmButton = getButton(root, CONFIRM);

      expect(confirmButton.props.disabled).toBe(true);
      expect(confirmButton.props.accessibilityState).toEqual({ disabled: true });

      press(root, CONFIRM);

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    });

    it('goes back to the hint when the last row is taken out', () => {
      const { root, update } = renderSheet([NAPKINS]);

      update({ items: [] });

      expect(getTexts(root)).toEqual([TITLE, EMPTY_HINT, CONFIRM, CANCEL]);
      expect(getButton(root, CONFIRM).props.disabled).toBe(true);
    });
  });

  describe('confirming', () => {
    it('confirms the purchase and closes, with a success haptic', () => {
      const { root, onConfirm, onClose } = renderSheet();
      const confirmButton = getButton(root, CONFIRM);

      expect(confirmButton.props.disabled).toBe(false);
      expect(confirmButton.props.accessibilityState).toEqual({ disabled: false });

      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Success
      );
    });

    it('confirms once when the button is pressed twice', () => {
      const { root, onConfirm, onClose } = renderSheet();

      press(root, CONFIRM);
      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    });

    it('confirms once when the second press lands while it fades out', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, onConfirm, update } = renderSheet();
      press(root, CONFIRM);
      // The purchase emptied the cart and the screen asked the sheet to close.
      update({ visible: false, items: [] });

      press(root, CONFIRM);

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps showing the bought rows while it fades out, instead of the empty hint', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, update } = renderSheet();
      press(root, CONFIRM);

      update({ visible: false, items: [] });

      expect(getTexts(root)).toContain('200 g · Pollo (Pechuga)');
      expect(getTexts(root)).not.toContain(EMPTY_HINT);
    });

    it('keeps the price of the bought rows while it fades out, instead of "Sin precio"', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, update } = renderSheet();
      const textsWhileOpen = getTexts(root);
      press(root, CONFIRM);

      // The bought rows left the list, and their offers left with them.
      update({ visible: false, items: [], bestOffers: {} });

      expect(getTexts(root)).toEqual(textsWhileOpen);
      expect(getTexts(root)).toContain('Día · $1.520');
    });

    it('follows the offers while it is open', () => {
      const { root, update } = renderSheet();

      update({ bestOffers: { 'planned:i2': { supermarket: 'Coto', unitPrice: 7, price: 1400 } } });

      expect(getTexts(root)).toContain('Coto · $1.400');
      expect(getTexts(root)).not.toContain('Día · $1.520');
    });

    it('shows the offers of the cart it is reopened with', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, update } = renderSheet();
      press(root, CONFIRM);
      update({ visible: false, items: [], bestOffers: {} });

      update({
        visible: true,
        items: [CHICKEN],
        bestOffers: { 'planned:i2': { supermarket: 'Coto', unitPrice: 7, price: 1400 } },
      });

      expect(getTexts(root)).toEqual([
        TITLE,
        '200 g · Pollo (Pechuga)',
        'Coto · $1.400',
        CONFIRM,
        CANCEL,
      ]);
    });

    it('confirms nothing from a press that lands while it fades out after a cancel', () => {
      mockKeepsChildrenWhileHidden = true;
      const { root, onConfirm, update } = renderSheet();
      press(root, CANCEL);
      update({ visible: false });

      press(root, CONFIRM);

      expect(onConfirm).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'confirms again once it is reopened (children kept while hidden: %s)',
      (keepsChildren) => {
        mockKeepsChildrenWhileHidden = keepsChildren;
        const { root, onConfirm, update } = renderSheet();
        press(root, CONFIRM);
        update({ visible: false, items: [] });

        update({ visible: true, items: [NAPKINS] });
        expect(getTexts(root)).toEqual([TITLE, 'Servilletas', 'Sin precio', CONFIRM, CANCEL]);
        press(root, CONFIRM);
        press(root, CONFIRM);

        expect(onConfirm).toHaveBeenCalledTimes(2);
      }
    );
  });

  it.each([CANCEL, 'Cerrar'])('closes from "%s" without confirming', (name) => {
    const { root, onConfirm, onClose, onTakeOut } = renderSheet();

    press(root, name);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onTakeOut).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('rests on the bottom edge, clear of the home indicator', () => {
    const { root } = renderSheet();

    expect(StyleSheet.flatten(getPanel(root).props.style).paddingBottom).toBe(34 + 16);
  });

  it('takes every color from the palette, by the roles of a dark surface', () => {
    const { root } = renderSheet();
    const [confirmSurface] = getButton(root, CONFIRM).findAllByType(View);

    expect(StyleSheet.flatten(getPanel(root).props.style).backgroundColor).toBe(
      mockTheme.colorDark
    );
    expect(getTextStyle(root, TITLE).color).toBe(mockTheme.textLight);
    expect(getTextStyle(root, '200 g · Pollo (Pechuga)').color).toBe(mockTheme.textLight);
    expect(getTextStyle(root, 'Día · $1.520').color).toBe(mockTheme.textMedium);
    expect(root.findAllByType(X).map((icon) => icon.props.color)).toEqual([
      mockTheme.icon,
      mockTheme.icon,
    ]);
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
    const { root } = renderSheet([]);

    expect(getTextStyle(root, EMPTY_HINT).color).toBe(withOpacity(mockTheme.textLight, 0.6));
  });
});
