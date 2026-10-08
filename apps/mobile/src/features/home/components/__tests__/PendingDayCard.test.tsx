/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { PendingDayCard } from '../PendingDayCard';
import type { HomeMealSummary } from '../../domain/localMealPlan';
import { getHomeMetrics } from '../../utils/responsive';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

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

jest.mock('@/hooks/useGradientCrossfade', () => {
  const { View } = require('react-native');

  return {
    useGradientCrossfade: (colors: [string, string]) => ({
      currentColors: colors,
      previousColors: colors,
      animatedStyle: {},
      AnimatedView: View,
    }),
  };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111108',
      colorMedium: '#333322',
      primaryAccent: '#ff6600',
      textLight: '#eeeedd',
      textMedium: '#cccc88',
    },
  }),
}));

const metrics = getHomeMetrics(390, 844);

const meals: HomeMealSummary[] = [
  { id: 'meal-1', type: 'lunch', name: 'Ensalada de tomate y lechuga' },
  { id: 'meal-2', type: 'dinner', name: 'Sopa de pollo con verdura' },
];

function renderTexts() {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<PendingDayCard selectedDate="2026-08-24" meals={meals} metrics={metrics} />);
  });

  return tree!.root.findAllByType(Text).map((node) => ({
    text: String(node.props.children),
    color: StyleSheet.flatten(node.props.style)?.color,
  }));
}

describe('PendingDayCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 25, 12, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the weekday and day number of the selected day', () => {
    expect(renderTexts().slice(0, 2)).toEqual([
      { text: 'Lunes', color: '#cccc88' },
      { text: '24', color: '#ff6600' },
    ]);
  });

  it('lists the meals of the day in the order it receives them', () => {
    expect(renderTexts().slice(2)).toEqual([
      { text: 'Ensalada de tomate y lechuga', color: '#eeeedd' },
      { text: 'Sopa de pollo con verdura', color: '#eeeedd' },
    ]);
  });

  it('paints the surface with the meal card gradient tokens', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PendingDayCard selectedDate="2026-08-24" meals={meals} metrics={metrics} />);
    });

    const gradients = tree!.root.findAllByType('LinearGradient' as never);

    expect(gradients.length).toBeGreaterThan(0);
    gradients.forEach((gradient) => {
      expect(gradient.props.colors).toEqual(['#333322', '#111108']);
    });
  });
});
