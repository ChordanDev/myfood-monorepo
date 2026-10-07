/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg } from 'react-native-svg';
import { AddCircleButton } from '../AddCircleButton';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');

  return {
    LinearGradient: ({ style }: { style: object }) => <View style={style} />,
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return {
    __esModule: true,
    default: { View },
    cancelAnimation: jest.fn(),
    Easing: { linear: jest.fn() },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111111',
      icon: '#ffffff',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
    },
  }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: () => ({ backgroundColor: '#111111' }),
}));

jest.mock('../ShadowSurface', () => ({
  ShadowSurface: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AddCircleButton', () => {
  it('gives the home add gradient a defined absolute fill style', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<AddCircleButton />);
    });

    const gradient = tree!.root.findByType(LinearGradient);

    expect(gradient.props.style).toBeDefined();
    expect(StyleSheet.flatten(gradient.props.style)).toEqual(
      expect.objectContaining({ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 })
    );
  });

  it('draws the plus glyph in the palette accent', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<AddCircleButton />);
    });

    const glyph = tree!.root.findByType(Svg);

    expect(glyph.props.stroke).toBe('currentColor');
    expect(glyph.props.color).toBe('#ff6600');
  });
});
