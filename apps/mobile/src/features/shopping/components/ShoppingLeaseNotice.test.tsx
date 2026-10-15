/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { ShoppingLeaseNotice } from './ShoppingLeaseNotice';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

// Only the surface the notice uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

const mockTheme = {
  colorLight: '#999999',
  textDark: '#222222',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

// Returns the colors as the style and records the calls, so the palette animation can be seen.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
}));

const MESSAGE = 'Perdimos la conexión y no pudimos renovar tu carrito. Puede que haya vencido.';

function renderNotice(): ReactTestInstance {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<ShoppingLeaseNotice />);
  });

  return tree!.root;
}

describe('ShoppingLeaseNotice', () => {
  beforeEach(() => {
    jest.mocked(useAnimatedThemeStyle).mockClear();
  });

  it('says the connection is lost and the Cart may have expired, with nothing to press', () => {
    const root = renderNotice();

    expect(root.findAllByType(Text).map((node) => node.props.children)).toEqual([MESSAGE]);
    expect(root.findAll((node) => typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  it('announces the message to a screen reader', () => {
    const root = renderNotice();
    const [message] = root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'alert'
    );

    expect(message.props.children).toBe(MESSAGE);
  });

  it('takes every color from the palette, by role, animated with it', () => {
    renderNotice();

    expect(jest.mocked(useAnimatedThemeStyle).mock.calls.map(([colors]) => colors)).toEqual([
      { backgroundColor: mockTheme.colorLight },
      { color: mockTheme.textDark },
    ]);
  });
});
