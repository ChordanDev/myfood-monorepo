/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { ShoppingListItem, ShoppingListLine } from '../types';
import { ShoppingItemRow } from './ShoppingItemRow';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('lucide-react-native', () => ({ Check: 'Check' }));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  impactAsync: jest.fn(),
}));

const mockTheme = {
  colorMedium: '#444444',
  primaryAccent: '#ff6600',
  textBlack: '#111111',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

// Returns the colors as the style and records the options, so `immediateKey` can be asserted.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
}));

const CHEESE: ShoppingListLine = {
  id: 'planned:cheese',
  source: 'planned_meal',
  status: 'needed',
  name: 'Queso cremoso',
  ingredientId: 'cheese',
  quantityMilli: 300_000,
  unit: 'g',
  category: 'lacteos',
  supermarketId: null,
  allocations: [],
};

// The second line of the row: the meals the cheese is for.
const CHEESE_MEALS = 'Para 2 comidas';

function renderRow(item: ShoppingListItem, meta?: string) {
  const onToggle = jest.fn();
  const onRemove = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ShoppingItemRow item={item} meta={meta} onToggle={onToggle} onRemove={onRemove} />
    );
  });

  return { tree: tree!, root: tree!.root, onToggle, onRemove };
}

// The row as the list shows it while nothing on it can be changed: without handlers.
function renderReadOnlyRow(item: ShoppingListItem, meta?: string) {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<ShoppingItemRow item={item} meta={meta} />);
  });

  return tree!.root;
}

// Drives the row through the touch responder, as a finger would: down, hold, up.
function touchRow(root: ReactTestInstance, holdMs: number) {
  const [target] = root.findAll(
    (node) => typeof node.type === 'string' && typeof node.props.onResponderGrant === 'function'
  );
  const touch = { pageX: 10, pageY: 10, locationX: 10, locationY: 10, timestamp: 0 };
  // Without a responder target the press is dropped before it reaches the handlers.
  const event = {
    currentTarget: 1,
    nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] },
    persist: () => {},
  };

  act(() => {
    target.props.onResponderGrant(event);
  });
  act(() => {
    jest.advanceTimersByTime(holdMs);
  });
  act(() => {
    target.props.onResponderRelease(event);
  });
}

// The `immediateKey` each animated part of the row was last rendered with. A part whose key
// changes between two renders applies its new colors at once instead of crossfading.
function getImmediateKeys() {
  const calls = jest.mocked(useAnimatedThemeStyle).mock.calls;
  const [name, meta] = calls.filter(([colors]) => 'color' in colors);
  const [checkbox] = calls.filter(([colors]) => 'backgroundColor' in colors);

  return {
    name: name[1]?.immediateKey,
    meta: meta[1]?.immediateKey,
    checkbox: checkbox[1]?.immediateKey,
  };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getCheckboxRow(root: ReactTestInstance) {
  const [row] = root.findAll(
    (node) =>
      node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function'
  );

  return row;
}

function getLineStyles(root: ReactTestInstance) {
  return root.findAllByType(Text).map((node) => StyleSheet.flatten(node.props.style));
}

function getCheckboxStyle(root: ReactTestInstance) {
  const [checkbox] = root.findAll((node) => node.props.testID === 'shopping-checkbox');

  return StyleSheet.flatten(checkbox.props.style);
}

describe('ShoppingItemRow', () => {
  beforeEach(() => {
    jest.mocked(Haptics.impactAsync).mockClear();
    jest.mocked(useAnimatedThemeStyle).mockClear();
  });

  it('renders the quantity and name line above the line of its meals', () => {
    const { root } = renderRow(CHEESE, CHEESE_MEALS);

    expect(getTexts(root)).toEqual(['300 g · Queso cremoso', 'Para 2 comidas']);
  });

  it('is a single line for an item that is for no meal', () => {
    const { root } = renderRow({
      id: 'manual:1',
      source: 'manual',
      status: 'needed',
      name: 'Papel de cocina',
    });

    expect(getTexts(root)).toEqual(['Papel de cocina']);
  });

  it('shows a needed item in full ink next to an empty checkbox', () => {
    const { root } = renderRow(CHEESE, CHEESE_MEALS);
    const [name, meta] = getLineStyles(root);

    expect(name).toEqual(expect.objectContaining({ color: mockTheme.textBlack }));
    expect(name.textDecorationLine).not.toBe('line-through');
    expect(meta).toEqual(expect.objectContaining({ color: withOpacity(mockTheme.textBlack, 0.6) }));
    expect(getCheckboxStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.primaryAccent, 0),
        borderColor: mockTheme.colorMedium,
        borderWidth: 1.5,
      })
    );
    expect(root.findAllByType(Check)).toEqual([]);
  });

  it('strikes through and dims an item in the cart, and checks its checkbox', () => {
    const { root } = renderRow({ ...CHEESE, status: 'in_cart' }, CHEESE_MEALS);
    const [name, meta] = getLineStyles(root);
    const dimmed = withOpacity(mockTheme.textBlack, 0.45);

    expect(name).toEqual(
      expect.objectContaining({ color: dimmed, textDecorationLine: 'line-through' })
    );
    expect(meta).toEqual(expect.objectContaining({ color: dimmed }));
    expect(getCheckboxStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.primaryAccent, 0.7),
        borderColor: mockTheme.primaryAccent,
      })
    );
    expect(root.findAllByType(Check).map((icon) => icon.props)).toEqual([
      { color: mockTheme.textBlack, size: 14, strokeWidth: 3 },
    ]);
  });

  it.each(['name', 'meta', 'checkbox'] as const)(
    'applies the in-cart look of the %s at once, without crossfading',
    (part) => {
      const { tree, onToggle } = renderRow(CHEESE, CHEESE_MEALS);
      const needed = getImmediateKeys();
      jest.mocked(useAnimatedThemeStyle).mockClear();

      act(() => {
        tree.update(
          <ShoppingItemRow
            item={{ ...CHEESE, status: 'in_cart' }}
            meta={CHEESE_MEALS}
            onToggle={onToggle}
            onRemove={jest.fn()}
          />
        );
      });
      const inCart = getImmediateKeys();

      expect(needed[part]).toBeDefined();
      expect(inCart[part]).toBeDefined();
      expect(inCart[part]).not.toBe(needed[part]);
    }
  );

  it('reports the id of the pressed item, with a light haptic', () => {
    const { root, onToggle } = renderRow(CHEESE, CHEESE_MEALS);

    act(() => {
      getCheckboxRow(root).props.onPress();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('planned:cheese');
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('is one checkbox that reads both lines and is unchecked while the item is needed', () => {
    const { root } = renderRow(CHEESE, CHEESE_MEALS);

    expect(getCheckboxRow(root).props).toEqual(
      expect.objectContaining({
        accessibilityLabel: '300 g · Queso cremoso, Para 2 comidas',
        accessibilityState: { checked: false },
      })
    );
  });

  it('reads only its first line when it has no second one', () => {
    const { root } = renderRow(CHEESE);

    expect(getCheckboxRow(root).props.accessibilityLabel).toBe('300 g · Queso cremoso');
  });

  it('is a checked checkbox once the item is in the cart', () => {
    const { root } = renderRow({ ...CHEESE, status: 'in_cart' }, CHEESE_MEALS);

    expect(getCheckboxRow(root).props.accessibilityState).toEqual({ checked: true });
  });

  describe('removing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('toggles on a tap', () => {
      const { root, onToggle, onRemove } = renderRow(CHEESE, CHEESE_MEALS);

      touchRow(root, 50);

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onRemove).not.toHaveBeenCalled();
    });

    it('reports the id of a long-pressed item, with a medium haptic, and does not toggle it', () => {
      const { root, onToggle, onRemove } = renderRow(CHEESE, CHEESE_MEALS);

      touchRow(root, 1000);

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith('planned:cheese');
      expect(onToggle).not.toHaveBeenCalled();
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
    });

    it('offers the removal as an accessibility action, for those who cannot long-press', () => {
      const { root, onToggle, onRemove } = renderRow(CHEESE, CHEESE_MEALS);
      const row = getCheckboxRow(root);

      expect(row.props.accessibilityActions).toEqual([
        { name: 'remove', label: 'Quitar de la lista' },
      ]);

      act(() => {
        row.props.onAccessibilityAction({ nativeEvent: { actionName: 'remove' } });
      });

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith('planned:cheese');
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('ignores an accessibility action it does not offer', () => {
      const { root, onToggle, onRemove } = renderRow(CHEESE, CHEESE_MEALS);

      act(() => {
        getCheckboxRow(root).props.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } });
      });

      expect(onRemove).not.toHaveBeenCalled();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('hints that a long press removes the item', () => {
      const { root } = renderRow(CHEESE, CHEESE_MEALS);

      expect(getCheckboxRow(root).props.accessibilityHint).toBe(
        'Mantené presionado para quitarlo de la lista.'
      );
    });
  });

  describe('read-only, without handlers', () => {
    // Every node a press, a long press or an accessibility action could reach.
    function getPressTargets(root: ReactTestInstance) {
      return root.findAll(
        (node) =>
          typeof node.props.onPress === 'function' ||
          typeof node.props.onLongPress === 'function' ||
          typeof node.props.onAccessibilityAction === 'function' ||
          typeof node.props.onResponderGrant === 'function'
      );
    }

    it('shows the same two lines', () => {
      const root = renderReadOnlyRow(CHEESE, CHEESE_MEALS);

      expect(getTexts(root)).toEqual(['300 g · Queso cremoso', 'Para 2 comidas']);
    });

    it.each([
      ['needed', CHEESE],
      ['in the cart', { ...CHEESE, status: 'in_cart' as const }],
    ])('has nothing to press, hold or act on while it is %s', (_name, item) => {
      const root = renderReadOnlyRow(item, CHEESE_MEALS);

      expect(getPressTargets(root)).toEqual([]);
      expect(root.findAll((node) => node.props.accessibilityRole === 'checkbox')).toEqual([]);
      expect(root.findAll((node) => node.props.accessibilityHint !== undefined)).toEqual([]);
    });

    it('shows no checkbox on a needed item: an empty box would ask to be pressed', () => {
      const root = renderReadOnlyRow(CHEESE, CHEESE_MEALS);
      const [name] = getLineStyles(root);

      expect(root.findAll((node) => node.props.testID === 'shopping-checkbox')).toEqual([]);
      expect(name).toEqual(expect.objectContaining({ color: mockTheme.textBlack }));
      expect(name.textDecorationLine).not.toBe('line-through');
    });

    it('strikes through, dims and ticks an item in the cart, as the pressable row does', () => {
      const root = renderReadOnlyRow({ ...CHEESE, status: 'in_cart' }, CHEESE_MEALS);
      const [name, meta] = getLineStyles(root);
      const dimmed = withOpacity(mockTheme.textBlack, 0.45);

      expect(name).toEqual(
        expect.objectContaining({ color: dimmed, textDecorationLine: 'line-through' })
      );
      expect(meta).toEqual(expect.objectContaining({ color: dimmed }));
      expect(getCheckboxStyle(root)).toEqual(
        expect.objectContaining({
          backgroundColor: withOpacity(mockTheme.primaryAccent, 0.7),
          borderColor: mockTheme.primaryAccent,
        })
      );
      expect(root.findAllByType(Check)).toHaveLength(1);
    });

    it('is one element that reads its lines, and that it is in the cart when it is', () => {
      const getLabels = (root: ReactTestInstance) =>
        root
          .findAll((node) => node.props.accessible === true && typeof node.type === 'string')
          .map((node) => node.props.accessibilityLabel);

      expect(getLabels(renderReadOnlyRow(CHEESE, CHEESE_MEALS))).toEqual([
        '300 g · Queso cremoso, Para 2 comidas',
      ]);
      expect(getLabels(renderReadOnlyRow(CHEESE))).toEqual(['300 g · Queso cremoso']);
      expect(getLabels(renderReadOnlyRow({ ...CHEESE, status: 'in_cart' }, CHEESE_MEALS))).toEqual([
        '300 g · Queso cremoso, Para 2 comidas, en el carrito',
      ]);
    });

    it('stays read-only with only the removal: a row is tickable or it is not pressable', () => {
      let tree: ReturnType<typeof create>;

      act(() => {
        tree = create(<ShoppingItemRow item={CHEESE} onRemove={jest.fn()} />);
      });

      expect(getPressTargets(tree!.root)).toEqual([]);
    });

    it('ticks with only the toggle, with no long press, hint or accessibility action', () => {
      const onToggle = jest.fn();
      let tree: ReturnType<typeof create>;

      act(() => {
        tree = create(<ShoppingItemRow item={CHEESE} onToggle={onToggle} />);
      });
      const [target] = tree!.root.findAll((node) => node.props.accessibilityRole === 'checkbox');

      act(() => target.props.onPress());

      expect(onToggle).toHaveBeenCalledWith(CHEESE.id);
      expect(target.props.onLongPress).toBeUndefined();
      expect(target.props.accessibilityHint).toBeUndefined();
      expect(target.props.accessibilityActions).toBeUndefined();
    });
  });
});
