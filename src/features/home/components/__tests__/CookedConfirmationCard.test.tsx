/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { CookedConfirmationCard } from '../CookedConfirmationCard';
import { getHomeMetrics } from '../../utils/responsive';

jest.mock('lucide-react-native', () => ({ Check: 'Check', X: 'X' }));

jest.mock('@/components', () => {
  const { View } = require('react-native');

  return { ShadowSurface: View };
});

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      alert: '#aa2200',
      colorBlack: '#0a0a05',
      colorMedium: '#333322',
      icon: '#cccc88',
      primaryAccent: '#ff6600',
      textLight: '#eeeedd',
    },
  }),
}));

const metrics = getHomeMetrics(390, 844);

function renderCard() {
  const onConfirmCooked = jest.fn();
  const onConfirmSkipped = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <CookedConfirmationCard
        metrics={metrics}
        onConfirmCooked={onConfirmCooked}
        onConfirmSkipped={onConfirmSkipped}
      />
    );
  });

  return { root: tree!.root, onConfirmCooked, onConfirmSkipped };
}

function getButton(root: ReactTestInstance, label: string) {
  const button = root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function'
  )[0];

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  return button;
}

function getViewStyles(root: ReactTestInstance) {
  return root.findAllByType(View).map((view) => StyleSheet.flatten(view.props.style));
}

describe('CookedConfirmationCard', () => {
  it('asks whether the recipe was cooked', () => {
    const { root } = renderCard();

    const question = root.findByType(Text);

    expect(question.props.children).toBe('¿Hiciste esta receta?');
    expect(StyleSheet.flatten(question.props.style)).toEqual(
      expect.objectContaining({ color: '#eeeedd' })
    );
  });

  it('confirms the meal as cooked from the check button', () => {
    const { root, onConfirmCooked, onConfirmSkipped } = renderCard();

    act(() => {
      getButton(root, 'Sí, la cociné').props.onPress();
    });

    expect(onConfirmCooked).toHaveBeenCalledTimes(1);
    expect(onConfirmSkipped).not.toHaveBeenCalled();
  });

  it('confirms the meal as not cooked from the cross button', () => {
    const { root, onConfirmCooked, onConfirmSkipped } = renderCard();

    act(() => {
      getButton(root, 'No la cociné').props.onPress();
    });

    expect(onConfirmSkipped).toHaveBeenCalledTimes(1);
    expect(onConfirmCooked).not.toHaveBeenCalled();
  });

  it('takes every color from the palette by role', () => {
    const { root } = renderCard();
    const viewStyles = getViewStyles(root);

    expect(viewStyles).toContainEqual(expect.objectContaining({ backgroundColor: '#0a0a05' }));
    expect(
      viewStyles.filter(
        (style) =>
          style?.backgroundColor === '#333322' && style?.borderColor === 'rgba(204, 204, 136, 0.3)'
      )
    ).toHaveLength(2);
    expect(root.findByType('Check' as never).props.color).toBe('#ff6600');
    expect(root.findByType('X' as never).props.color).toBe('#aa2200');
  });
});
