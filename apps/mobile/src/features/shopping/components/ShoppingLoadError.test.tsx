/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { ShoppingLoadError } from './ShoppingLoadError';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

// Only the surface the notice uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

const mockTheme = {
  colorDark: '#111111',
  colorLight: '#999999',
  textDark: '#222222',
  textLight: '#eeeeee',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

// Returns the colors as the style and records the calls, so the palette animation can be seen.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
}));

const MESSAGE = 'No pudimos conectar con el servidor. Revisá tu conexión.';

function renderNotice() {
  const onRetry = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<ShoppingLoadError message={MESSAGE} onRetry={onRetry} />);
  });

  return { root: tree!.root, onRetry };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getButton(root: ReactTestInstance) {
  const [button] = root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );

  return button;
}

describe('ShoppingLoadError', () => {
  beforeEach(() => {
    jest.mocked(useAnimatedThemeStyle).mockClear();
  });

  it('writes why the list could not be read, above the way to try again', () => {
    const { root } = renderNotice();

    expect(getTexts(root)).toEqual([MESSAGE, 'Reintentar']);
  });

  it('announces the message to a screen reader', () => {
    const { root } = renderNotice();
    const [message] = root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'alert'
    );

    expect(message.props.children).toBe(MESSAGE);
  });

  it('reports a press on the retry, once', () => {
    const { root, onRetry } = renderNotice();

    act(() => {
      getButton(root).props.onPress();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gives the retry a touch target of at least 44 pt', () => {
    const { root } = renderNotice();
    const heights = getButton(root)
      .findAllByType(View)
      .map((view) => StyleSheet.flatten(view.props.style)?.minHeight ?? 0);

    expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
  });

  it('takes every color from the palette, by role, animated with it', () => {
    renderNotice();

    expect(jest.mocked(useAnimatedThemeStyle).mock.calls.map(([colors]) => colors)).toEqual([
      { backgroundColor: mockTheme.colorLight },
      { color: mockTheme.textDark },
      { backgroundColor: mockTheme.colorDark },
      { color: mockTheme.textLight },
    ]);
  });

  it('names the button as the caller says, and still calls the same handler', () => {
    const onRetry = jest.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <ShoppingLoadError message={MESSAGE} onRetry={onRetry} actionLabel="Entendido" />
      );
    });

    expect(getTexts(tree!.root)).toEqual([MESSAGE, 'Entendido']);
    act(() => {
      getButton(tree!.root).props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
