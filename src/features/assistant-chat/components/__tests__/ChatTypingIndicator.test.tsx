/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ChatTypingIndicator } from '../ChatTypingIndicator';

const mockCancelAnimation = jest.fn();
const mockUseReducedMotion = jest.fn(() => false);
const mockWithRepeat = jest.fn(
  (animation: unknown, _numberOfReps?: number, _reverse?: boolean) => animation
);
const mockWithSequence = jest.fn((...animations: unknown[]) => animations.at(-1));
const mockWithTiming = jest.fn((value: number, _config?: unknown) => value);
const mockSharedValue = {
  get: jest.fn(() => 0),
  set: jest.fn(),
};
let mockTheme = {
  appBg: '#f4ead0',
  textBlack: '#221f17',
};

jest.mock('react-native-reanimated', () => {
  const { View: MockView } = require('react-native');

  return {
    __esModule: true,
    default: { View: MockView },
    cancelAnimation: (...args: unknown[]) => mockCancelAnimation(...args),
    Easing: {
      cubic: jest.fn(),
      inOut: (easing: unknown) => easing,
    },
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: () => mockUseReducedMotion(),
    useSharedValue: () => mockSharedValue,
    withRepeat: (animation: unknown, numberOfReps?: number, reverse?: boolean) =>
      mockWithRepeat(animation, numberOfReps, reverse),
    withSequence: (...args: unknown[]) => mockWithSequence(...args),
    withTiming: (value: number, config?: unknown) => mockWithTiming(value, config),
  };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

beforeEach(() => {
  mockCancelAnimation.mockClear();
  mockSharedValue.get.mockClear();
  mockSharedValue.set.mockClear();
  mockUseReducedMotion.mockReset();
  mockUseReducedMotion.mockReturnValue(false);
  mockWithRepeat.mockClear();
  mockWithSequence.mockClear();
  mockWithTiming.mockClear();
  mockTheme = {
    appBg: '#f4ead0',
    textBlack: '#221f17',
  };
});

describe('ChatTypingIndicator', () => {
  it('presents one seed status with a stable Spanish label', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<ChatTypingIndicator />);
    });

    const indicator = tree!.root.findByProps({ testID: 'planner-typing-indicator' });
    const labels = tree!.root.findAllByType(Text);

    expect(indicator.props).toEqual(
      expect.objectContaining({
        accessible: true,
        accessibilityLabel: 'Preparando respuesta',
        accessibilityLiveRegion: 'polite',
        accessibilityState: { busy: true },
        role: 'status',
      })
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].props.children).toBe('Preparando respuesta…');
    expect(
      tree!.root.findAllByProps({ testID: 'planner-thinking-seed-shape' }).length
    ).toBeGreaterThanOrEqual(1);

    act(() => tree!.unmount());
  });

  it('uses the current theme for the seed, vein, and label', () => {
    mockTheme = {
      appBg: '#17201a',
      textBlack: '#f6f0d9',
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<ChatTypingIndicator />);
    });

    const seed = tree!.root.findByProps({ testID: 'planner-thinking-seed-shape' });
    const vein = tree!.root.findByProps({ testID: 'planner-thinking-seed-vein' });
    const label = tree!.root.findByType(Text);

    expect(StyleSheet.flatten(seed.props.style).backgroundColor).toBe('#f6f0d9');
    expect(StyleSheet.flatten(vein.props.style).backgroundColor).toBe('#17201a');
    expect(StyleSheet.flatten(label.props.style).color).toBe('#f6f0d9');

    act(() => tree!.unmount());
  });

  it('keeps the decorative seed noninteractive and out of the accessibility tree', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<ChatTypingIndicator />);
    });

    const indicator = tree!.root.findByProps({ testID: 'planner-typing-indicator' });
    const seedBody = tree!.root.findByProps({ testID: 'planner-thinking-seed-body' });
    const decoration = seedBody.parent!;

    expect(indicator.props.pointerEvents).toBe('none');
    expect(decoration.props.accessible).toBe(false);
    expect(decoration.props.accessibilityElementsHidden).toBe(true);
    expect(decoration.props.importantForAccessibility).toBe('no-hide-descendants');

    act(() => tree!.unmount());
  });

  it('uses a static resting presentation when reduced motion is enabled', () => {
    mockUseReducedMotion.mockReturnValue(true);
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<ChatTypingIndicator />);
    });

    const seedBodyStyle = StyleSheet.flatten(
      tree!.root.findByProps({ testID: 'planner-thinking-seed-body' }).props.style
    );

    expect(mockWithRepeat).not.toHaveBeenCalled();
    expect(mockSharedValue.set).toHaveBeenCalledTimes(1);
    expect(mockSharedValue.set).toHaveBeenCalledWith(0);
    expect(seedBodyStyle).toEqual(
      expect.objectContaining({ opacity: 0.82, transform: [{ scale: 1 }] })
    );

    act(() => tree!.unmount());
  });

  it('cancels and resets the breathing pulse when it unmounts', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<ChatTypingIndicator />);
    });

    expect(mockWithTiming).toHaveBeenNthCalledWith(1, 1, {
      duration: 900,
      easing: expect.anything(),
    });
    expect(mockWithTiming).toHaveBeenNthCalledWith(2, 0, {
      duration: 900,
      easing: expect.anything(),
    });
    expect(mockWithRepeat).toHaveBeenCalledWith(expect.anything(), -1, false);

    act(() => tree!.unmount());

    expect(mockCancelAnimation).toHaveBeenCalledTimes(2);
    expect(mockCancelAnimation).toHaveBeenLastCalledWith(mockSharedValue);
    expect(mockSharedValue.set).toHaveBeenLastCalledWith(0);
  });

  it('keeps fixed layout geometry and forwards the native layout callback', () => {
    const onLayout = jest.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<ChatTypingIndicator onLayout={onLayout} />);
    });

    const indicator = tree!.root.findByProps({ testID: 'planner-typing-indicator' });
    const seedBody = tree!.root.findByProps({ testID: 'planner-thinking-seed-body' });
    const indicatorStyle = StyleSheet.flatten(indicator.props.style);
    const seedBodyStyle = StyleSheet.flatten(seedBody.props.style);

    expect(indicator.props.onLayout).toBe(onLayout);
    expect(indicatorStyle).toEqual(expect.objectContaining({ height: 28, width: 190 }));
    expect(seedBodyStyle).toEqual(
      expect.objectContaining({
        height: 24,
        width: 24,
        opacity: 0.82,
        transform: [{ scale: 1 }],
      })
    );
    expect(seedBodyStyle).not.toHaveProperty('top');
    expect(seedBodyStyle).not.toHaveProperty('left');

    act(() => tree!.unmount());
  });
});
