/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { LinearGradient } from 'expo-linear-gradient';
import { ShoppingCart } from 'lucide-react-native';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { SHOPPING_CART_BUTTON_SIZE, ShoppingCartButton } from './ShoppingCartButton';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');

  return {
    LinearGradient: ({ style }: { style: object }) => <View style={style} />,
  };
});

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return {
    __esModule: true,
    default: { Text, View },
    cancelAnimation: jest.fn(),
    Easing: { linear: 'linear' },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

// Only the surface the button uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('lucide-react-native', () => ({ ShoppingCart: 'ShoppingCart' }));

const mockTheme = {
  colorDark: '#111111',
  colorLight: '#999999',
  icon: '#cccccc',
  primaryAccent: '#ff6600',
  primaryAccentIntense: '#ff3300',
  textBlack: '#050505',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

// Returns the colors as the style and records the calls, so the palette animation can be seen.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
}));

function renderButton(count: number) {
  const onPress = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<ShoppingCartButton count={count} onPress={onPress} />);
  });

  return { root: tree!.root, onPress };
}

function getButton(root: ReactTestInstance) {
  const [button] = root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );

  return button;
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => String(node.props.children));
}

function getViewStyles(root: ReactTestInstance) {
  return root.findAllByType(View).map((view) => StyleSheet.flatten(view.props.style) ?? {});
}

// The view that wraps the count, with everything that hides it from assistive technologies.
function getBadge(root: ReactTestInstance) {
  const [badge] = root
    .findAllByType(View)
    .filter((view) => view.props.importantForAccessibility === 'no-hide-descendants');

  return badge;
}

describe('ShoppingCartButton', () => {
  beforeEach(() => {
    jest.mocked(useAnimatedThemeStyle).mockClear();
  });

  it('is a button that says the cart is empty, with no badge, while nothing is marked', () => {
    const { root } = renderButton(0);

    expect(getButton(root).props.accessibilityLabel).toBe('Ver carrito, vacío');
    expect(getTexts(root)).toEqual([]);
    expect(getBadge(root)).toBeUndefined();
  });

  it.each([
    [1, 'Ver carrito, 1 ítem'],
    [2, 'Ver carrito, 2 ítems'],
    [12, 'Ver carrito, 12 ítems'],
  ])('shows %i in a badge and reads "%s"', (count, label) => {
    const { root } = renderButton(count);

    expect(getButton(root).props.accessibilityLabel).toBe(label);
    expect(getTexts(root)).toEqual([String(count)]);
  });

  it('reports a press, once', () => {
    const { root, onPress } = renderButton(2);

    act(() => {
      getButton(root).props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shrinks a little while it is pressed', () => {
    const { root } = renderButton(0);
    const { style } = getButton(root).props;

    expect(StyleSheet.flatten(style({ pressed: true })).transform).toEqual([{ scale: 0.95 }]);
    expect(StyleSheet.flatten(style({ pressed: false })).transform).toEqual([{ scale: 1 }]);
  });

  it('is a 56 pt circle with a 3 pt ring, as the add button of Home', () => {
    const { root } = renderButton(0);
    const button = StyleSheet.flatten(getButton(root).props.style({ pressed: false }));

    expect(SHOPPING_CART_BUTTON_SIZE).toBe(56);
    expect(button).toEqual(
      expect.objectContaining({ borderRadius: 28, height: 56, overflow: 'hidden', width: 56 })
    );
    // The dark face leaves 3 pt of the gradient showing all around it.
    expect(getViewStyles(root)).toContainEqual(
      expect.objectContaining({ borderRadius: 25, height: 50, width: 50 })
    );
  });

  it('takes the ring, the face and the cart from the palette, by role', () => {
    const { root } = renderButton(0);

    expect(root.findByType(LinearGradient).props.colors).toEqual([
      mockTheme.primaryAccentIntense,
      mockTheme.icon,
      mockTheme.primaryAccent,
      mockTheme.primaryAccentIntense,
    ]);
    expect(getViewStyles(root)).toContainEqual(
      expect.objectContaining({ backgroundColor: mockTheme.colorDark, width: 50 })
    );
    expect(root.findByType(ShoppingCart).props.color).toBe(mockTheme.primaryAccent);
    // No immediate key: a palette change crossfades the face.
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ backgroundColor: mockTheme.colorDark });
  });

  it('writes the count in body ink on the light surface, ringed by the dark one', () => {
    const { root } = renderButton(3);
    const badge = getBadge(root);
    const [count] = root.findAllByType(Text);

    // `textBlack` on `colorLight` is a pair every palette keeps readable.
    expect(StyleSheet.flatten(badge.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: mockTheme.colorLight,
        borderColor: mockTheme.colorDark,
        position: 'absolute',
      })
    );
    expect(StyleSheet.flatten(count.props.style).color).toBe(mockTheme.textBlack);
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({
      backgroundColor: mockTheme.colorLight,
      borderColor: mockTheme.colorDark,
    });
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ color: mockTheme.textBlack });
  });

  it('keeps the badge out of the way of touches and of screen readers: the label has the count', () => {
    const { root } = renderButton(3);
    const badge = getBadge(root);

    expect(badge.props.pointerEvents).toBe('none');
    expect(badge.props.accessibilityElementsHidden).toBe(true);
    // The badge is drawn outside the circle, so it cannot be a child of the clipped button.
    expect(getButton(root).findAllByType(Text)).toEqual([]);
  });
});
