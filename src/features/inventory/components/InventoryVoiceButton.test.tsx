/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, ReactTestRendererJSON } from 'react-test-renderer';
import { Mic } from 'lucide-react-native';
import { InventoryVoiceButton } from './InventoryVoiceButton';

jest.mock('@/components', () => {
  const { View } = require('react-native');

  return { ShadowSurface: View };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#eeeeee',
      colorDark: '#111111',
    },
  }),
}));

function renderButton(onPress?: () => void) {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<InventoryVoiceButton onPress={onPress} />);
  });

  return tree!;
}

describe('InventoryVoiceButton', () => {
  it('is a labelled button that reports presses', () => {
    const onPress = jest.fn();
    const { root } = renderButton(onPress);

    const button = root.find(
      (node) =>
        node.props.accessibilityLabel === 'Agregar o editar por voz' &&
        typeof node.props.onPress === 'function'
    );

    act(() => {
      button.props.onPress();
    });

    expect(button.props.accessibilityRole).toBe('button');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('floats on the right, just above the custom tab bar', () => {
    const tree = renderButton();

    const container = tree.toJSON() as ReactTestRendererJSON;

    // 34 of safe area + 60 of tab bar + 12 of gap.
    expect(StyleSheet.flatten(container.props.style)).toEqual(
      expect.objectContaining({ bottom: 106, position: 'absolute', right: 14 })
    );
  });

  it('draws the microphone in the ground color of the palette', () => {
    const { root } = renderButton();

    expect(root.findByType(Mic).props.color).toBe('#eeeeee');
  });
});
