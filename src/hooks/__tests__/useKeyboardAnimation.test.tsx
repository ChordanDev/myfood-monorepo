/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Keyboard, KeyboardEvent, Platform, useWindowDimensions } from 'react-native';
import { act, create } from 'react-test-renderer';
import {
  calculateBottomAnchoredKeyboardLift,
  KeyboardAnimationOptions,
  useKeyboardAnimation,
} from '../useKeyboardAnimation';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');

  return {
    cancelAnimation: jest.fn(),
    Easing: {
      bezier: jest.fn(() => 'bezier'),
      cubic: 'cubic',
      out: jest.fn(() => 'out'),
    },
    useAnimatedStyle: (factory: () => object) => ({
      get transform() {
        return (factory() as { transform: unknown }).transform;
      },
    }),
    useSharedValue: (value: number) => React.useRef({ value }).current,
    withTiming: (value: number) => value,
  };
});

const originalPlatformOS = Platform.OS;
const listeners: Partial<Record<string, (event: KeyboardEvent) => void>> = {};
const geometryOptions = {
  mode: 'geometry',
  restingBottomOffset: 106,
  clearance: 12,
} as const;
let windowDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
let hookResult: ReturnType<typeof useKeyboardAnimation>;

function HookHarness({ options }: { options: KeyboardAnimationOptions }) {
  hookResult = useKeyboardAnimation(options);
  return null;
}

function keyboardEvent(screenY: number, height: number): KeyboardEvent {
  const coordinates = { height, screenX: 0, screenY, width: 390 };

  return {
    duration: 250,
    easing: 'keyboard',
    endCoordinates: coordinates,
    isEventFromThisApp: true,
    startCoordinates: coordinates,
  };
}

function translateY() {
  const style = hookResult.inputAnimatedStyle as unknown as {
    transform: { translateY: number }[];
  };

  return style.transform[0].translateY;
}

function renderHook(options: KeyboardAnimationOptions) {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<HookHarness options={options} />);
  });

  return tree!;
}

describe('calculateBottomAnchoredKeyboardLift', () => {
  it('returns the exact lift for the captured Planner geometry', () => {
    expect(
      calculateBottomAnchoredKeyboardLift({
        closedWindowHeight: 844,
        restingBottomOffset: 106,
        keyboardTop: 509,
        clearance: 12,
      })
    ).toBe(241);
  });

  it('returns zero when the requested clearance exactly meets the keyboard', () => {
    expect(
      calculateBottomAnchoredKeyboardLift({
        closedWindowHeight: 844,
        restingBottomOffset: 106,
        keyboardTop: 750,
        clearance: 12,
      })
    ).toBe(0);
  });

  it('returns zero when the target is already clear', () => {
    expect(
      calculateBottomAnchoredKeyboardLift({
        closedWindowHeight: 844,
        restingBottomOffset: 106,
        keyboardTop: 760,
        clearance: 12,
      })
    ).toBe(0);
  });
});

describe('useKeyboardAnimation', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    windowDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
    Object.keys(listeners).forEach((eventName) => delete listeners[eventName]);
    jest.mocked(useWindowDimensions).mockImplementation(() => windowDimensions);
    jest.spyOn(Keyboard, 'addListener').mockImplementation((eventName, listener) => {
      listeners[eventName] = listener;
      return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOS });
  });

  it('uses deterministic bottom-anchored geometry', () => {
    const tree = renderHook(geometryOptions);

    act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));

    expect(translateY()).toBe(-241);
    expect(hookResult.isKeyboardOpen).toBe(true);

    act(() => tree.unmount());
  });

  it('uses absolute iOS frame geometry without accumulating repeated event deltas', () => {
    const tree = renderHook(geometryOptions);

    act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));
    act(() => listeners.keyboardWillChangeFrame?.(keyboardEvent(480, 364)));
    expect(translateY()).toBe(-270);

    act(() => listeners.keyboardWillChangeFrame?.(keyboardEvent(480, 364)));
    expect(translateY()).toBe(-270);

    act(() => tree.unmount());
  });

  it('restores exactly to zero on hide', () => {
    const tree = renderHook(geometryOptions);

    act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));
    act(() => listeners.keyboardWillHide?.(keyboardEvent(844, 0)));

    expect(translateY()).toBe(0);
    expect(hookResult.isKeyboardOpen).toBe(false);

    act(() => tree.unmount());
  });

  it('resets lift and open state when disabled', () => {
    const tree = renderHook(geometryOptions);

    act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));
    expect(translateY()).toBe(-241);

    act(() => {
      tree.update(<HookHarness options={{ ...geometryOptions, enabled: false }} />);
    });

    expect(translateY()).toBe(0);
    expect(hookResult.isKeyboardOpen).toBe(false);

    act(() => tree.unmount());
  });

  it('preserves the legacy proportional calculation when explicitly selected', () => {
    const tree = renderHook({ mode: 'proportional', liftFactor: 0.4 });

    act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));

    expect(translateY()).toBe(-134);

    act(() => tree.unmount());
  });

  it('does not replace the closed baseline when Android adjustResize shrinks the window', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    const tree = renderHook(geometryOptions);

    windowDimensions = { ...windowDimensions, height: 509 };
    act(() => {
      tree.update(<HookHarness options={geometryOptions} />);
    });
    act(() => listeners.keyboardDidShow?.(keyboardEvent(509, 335)));

    expect(translateY()).toBe(-241);

    act(() => listeners.keyboardDidShow?.(keyboardEvent(509, 335)));
    expect(translateY()).toBe(-241);

    act(() => listeners.keyboardDidHide?.(keyboardEvent(844, 0)));
    expect(translateY()).toBe(0);

    act(() => tree.unmount());
  });
});
