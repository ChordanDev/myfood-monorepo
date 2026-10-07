/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { DayCell, type DayCellProps } from '../DayCell';

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(),
}));

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
      colorMedium: '#333322',
      icon: '#cccc88',
      primaryAccent: '#ff6600',
    },
  }),
}));

function renderDayCell(overrides: Partial<DayCellProps> = {}) {
  const onSelect = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <DayCell
        dayDate={new Date(2026, 7, 6)}
        dateString="2026-08-06"
        isSelectable
        isSelected={false}
        isToday={false}
        isPlanned
        isPendingConfirmation={false}
        daySize={40}
        dayFontSize={14}
        textColor="#111100"
        onSelect={onSelect}
        {...overrides}
      />
    );
  });

  return { root: tree!.root, onSelect };
}

function getCircleStyle(root: ReactTestInstance) {
  return root
    .findAllByType(View)
    .map((view) => StyleSheet.flatten(view.props.style))
    .find((style) => style?.borderRadius === 20);
}

function getButton(root: ReactTestInstance) {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  )[0];
}

function getDayText(root: ReactTestInstance) {
  return String(root.findByType(Text).props.children);
}

describe('DayCell', () => {
  it('fills a pending day with the alert token at 70% and outlines it with the same token', () => {
    const { root } = renderDayCell({ isPendingConfirmation: true });

    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(170, 34, 0, 0.7)',
        borderColor: '#aa2200',
        borderWidth: 1,
      })
    );
  });

  it('keeps the alert fill and uses the 2px colorMedium ring when a pending day is selected', () => {
    const { root } = renderDayCell({ isPendingConfirmation: true, isSelected: true });

    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(170, 34, 0, 0.7)',
        borderColor: '#333322',
        borderWidth: 2,
      })
    );
  });

  it('shows an exclamation mark on a pending day and keeps the day number in its label', () => {
    const { root } = renderDayCell({ isPendingConfirmation: true });

    expect(getDayText(root)).toBe('!');
    expect(getButton(root).props.accessibilityLabel).toBe('6, comida sin confirmar');
  });

  it('selects the date when a pending day is pressed', () => {
    const { root, onSelect } = renderDayCell({ isPendingConfirmation: true });

    act(() => {
      getButton(root).props.onPress();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('2026-08-06');
  });

  it('keeps the planned look and the day number when the day is not pending', () => {
    const { root } = renderDayCell();

    expect(getDayText(root)).toBe('6');
    expect(getButton(root).props.accessibilityLabel).toBeUndefined();
    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(204, 204, 136, 0.7)',
        borderColor: '#cccc88',
        borderWidth: 1,
      })
    );
  });
});

describe('DayCell inside a range', () => {
  it('tints a day inside the range with the selection token at a lower opacity', () => {
    const { root } = renderDayCell({ isPlanned: false, isInRange: true });

    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(255, 102, 0, 0.3)',
        borderWidth: 0,
      })
    );
  });

  it('keeps the outline of a planned day inside the range', () => {
    const { root } = renderDayCell({ isPlanned: true, isInRange: true });

    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(255, 102, 0, 0.3)',
        borderColor: '#cccc88',
        borderWidth: 1,
      })
    );
  });

  it('keeps the ring of today inside the range', () => {
    const { root } = renderDayCell({ isToday: true, isInRange: true });

    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(255, 102, 0, 0.3)',
        borderColor: '#333322',
        borderWidth: 1,
      })
    );
  });

  it('draws an end of the range like any selected day', () => {
    const { root } = renderDayCell({ isSelected: true, isInRange: true });

    expect(getCircleStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: 'rgba(255, 102, 0, 0.7)',
        borderColor: '#ff6600',
        borderWidth: 1,
      })
    );
  });

  it('can still be pressed inside the range', () => {
    const { root, onSelect } = renderDayCell({ isInRange: true });

    act(() => {
      getButton(root).props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith('2026-08-06');
  });
});
