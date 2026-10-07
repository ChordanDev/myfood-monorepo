/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import { EatTodayButton } from '../EatTodayButton';

jest.mock('@shopify/react-native-skia', () => ({
  BlurMask: () => null,
  Canvas: () => null,
  RoundedRect: () => null,
}));

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return {
    __esModule: true,
    default: { Text, View },
    Easing: { inOut: jest.fn(), sin: jest.fn() },
    interpolate: () => 0,
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

describe('EatTodayButton', () => {
  it('outlines the pill with the label color from the palette', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <EatTodayButton
          leftPercent={50}
          topPercent={50}
          widthPercent={40}
          sizeScale={1}
          backgroundColor="#ff6600"
          textColor="#221100"
          borderColor="#ff3300"
          onPress={jest.fn()}
        />
      );
    });

    const outline = tree!.root
      .findAllByType(View)
      .map((view) => StyleSheet.flatten(view.props.style))
      .find((style) => style?.borderWidth === 2);

    expect(outline).toEqual(expect.objectContaining({ borderColor: '#221100' }));
  });
});
