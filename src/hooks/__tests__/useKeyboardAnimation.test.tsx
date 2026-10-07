/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Keyboard, KeyboardEvent, Platform, useWindowDimensions } from 'react-native';
import { act, create } from 'react-test-renderer';
import {
  calculateBottomAnchoredKeyboardLift,
  calculateKeyboardHeightLift,
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
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
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

describe('calculateKeyboardHeightLift', () => {
  const geometry = {
    keyboardHeight: 300,
    bottomInset: 24,
    restingBottomOffset: 96,
    clearance: 12,
  };

  it('lifts by the keyboard height and the bottom inset above the resting offset', () => {
    expect(calculateKeyboardHeightLift(geometry)).toBe(240);
  });

  it('defaults the bottom inset and the clearance to zero', () => {
    expect(calculateKeyboardHeightLift({ keyboardHeight: 300, restingBottomOffset: 96 })).toBe(204);
  });

  it('returns zero when the requested clearance exactly meets the keyboard', () => {
    expect(calculateKeyboardHeightLift({ ...geometry, keyboardHeight: 60 })).toBe(0);
  });

  it('returns zero when the keyboard is shorter than the resting offset', () => {
    expect(calculateKeyboardHeightLift({ ...geometry, keyboardHeight: 40 })).toBe(0);
  });

  it.each(['keyboardHeight', 'bottomInset', 'restingBottomOffset', 'clearance'] as const)(
    'returns zero when %s is not finite',
    (input) => {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(calculateKeyboardHeightLift({ ...geometry, [input]: value })).toBe(0);
      }
    }
  );
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

  it('keeps the iOS frame geometry when a bottom inset is supplied', () => {
    const tree = renderHook({ ...geometryOptions, bottomInset: 34 });

    act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));

    expect(translateY()).toBe(-241);

    act(() => tree.unmount());
  });

  it('preserves the proportional calculation on Android', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    const tree = renderHook({ mode: 'proportional', liftFactor: 0.4 });

    act(() => listeners.keyboardDidShow?.(keyboardEvent(520, 300)));

    expect(translateY()).toBe(-120);

    act(() => tree.unmount());
  });

  describe('Android geometry', () => {
    // An 844dp edge-to-edge container over a 24dp navigation bar. The keyboard top is 324dp above
    // the container bottom, and the event reports the 300dp that stand above the navigation bar.
    const androidGeometryOptions = {
      mode: 'geometry',
      restingBottomOffset: 96,
      clearance: 12,
      bottomInset: 24,
    } as const;

    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
      // Window metrics that leave the navigation bar out, so they are shorter than the container.
      windowDimensions = { ...windowDimensions, height: 820 };
    });

    it('lifts by the keyboard height and the bottom inset above the resting offset', () => {
      const tree = renderHook(androidGeometryOptions);

      act(() => listeners.keyboardDidShow?.(keyboardEvent(520, 300)));

      expect(translateY()).toBe(-240);
      expect(hookResult.isKeyboardOpen).toBe(true);

      act(() => tree.unmount());
    });

    it.each([
      { windowHeight: 844, screenY: 520 },
      { windowHeight: 820, screenY: 520 },
      { windowHeight: 796, screenY: 544 },
      { windowHeight: 520, screenY: 496 },
    ])(
      'ignores a window $windowHeight tall and a keyboard top at $screenY',
      ({ windowHeight, screenY }) => {
        windowDimensions = { ...windowDimensions, height: windowHeight };
        const tree = renderHook(androidGeometryOptions);

        act(() => listeners.keyboardDidShow?.(keyboardEvent(screenY, 300)));

        expect(translateY()).toBe(-240);

        act(() => tree.unmount());
      }
    );

    it('follows the keyboard height when it changes while the keyboard stays open', () => {
      const tree = renderHook(androidGeometryOptions);

      act(() => listeners.keyboardDidShow?.(keyboardEvent(520, 300)));
      expect(translateY()).toBe(-240);

      // Android emits keyboardDidShow again when, for example, the emoji panel opens.
      act(() => listeners.keyboardDidShow?.(keyboardEvent(472, 348)));
      expect(translateY()).toBe(-288);

      act(() => tree.unmount());
    });

    it('uses the latest bottom inset', () => {
      const tree = renderHook(androidGeometryOptions);

      act(() => {
        tree.update(<HookHarness options={{ ...androidGeometryOptions, bottomInset: 48 }} />);
      });
      act(() => listeners.keyboardDidShow?.(keyboardEvent(520, 300)));

      expect(translateY()).toBe(-264);

      act(() => tree.unmount());
    });

    it('restores exactly to zero on hide', () => {
      const tree = renderHook(androidGeometryOptions);

      act(() => listeners.keyboardDidShow?.(keyboardEvent(520, 300)));
      expect(translateY()).toBe(-240);

      act(() => listeners.keyboardDidHide?.(keyboardEvent(844, 0)));

      expect(translateY()).toBe(0);
      expect(hookResult.isKeyboardOpen).toBe(false);

      act(() => tree.unmount());
    });
  });

  // The same number the animated style is heading to, for layout that has to make room for the
  // lifted element (a list padding, for example) without a second keyboard computation.
  describe('commanded lift as plain state', () => {
    it('is zero while the keyboard is closed', () => {
      const tree = renderHook(geometryOptions);

      expect(hookResult.keyboardLift).toBe(0);

      act(() => tree.unmount());
    });

    it('reports the lift of the open keyboard and returns to zero when it hides', () => {
      const tree = renderHook(geometryOptions);

      act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));

      expect(hookResult.keyboardLift).toBe(241);
      expect(translateY()).toBe(-241);

      act(() => listeners.keyboardWillHide?.(keyboardEvent(844, 0)));

      expect(hookResult.keyboardLift).toBe(0);

      act(() => tree.unmount());
    });

    it('follows the keyboard frame while it stays open', () => {
      const tree = renderHook(geometryOptions);

      act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));
      act(() => listeners.keyboardWillChangeFrame?.(keyboardEvent(480, 364)));

      expect(hookResult.keyboardLift).toBe(270);

      act(() => tree.unmount());
    });

    it('is zero when the keyboard does not reach the resting element', () => {
      const tree = renderHook(geometryOptions);

      act(() => listeners.keyboardWillShow?.(keyboardEvent(760, 84)));

      expect(hookResult.isKeyboardOpen).toBe(true);
      expect(hookResult.keyboardLift).toBe(0);

      act(() => tree.unmount());
    });

    it('reports the Android lift, computed from the keyboard height', () => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
      const tree = renderHook({ ...geometryOptions, restingBottomOffset: 96, bottomInset: 24 });

      act(() => listeners.keyboardDidShow?.(keyboardEvent(520, 300)));

      expect(hookResult.keyboardLift).toBe(240);

      act(() => listeners.keyboardDidHide?.(keyboardEvent(844, 0)));

      expect(hookResult.keyboardLift).toBe(0);

      act(() => tree.unmount());
    });

    it('reports the proportional lift', () => {
      const tree = renderHook({ mode: 'proportional', liftFactor: 0.4 });

      act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));

      expect(hookResult.keyboardLift).toBe(134);

      act(() => tree.unmount());
    });

    it('returns to zero when the hook is disabled with the keyboard open', () => {
      const tree = renderHook(geometryOptions);

      act(() => listeners.keyboardWillShow?.(keyboardEvent(509, 335)));
      act(() => {
        tree.update(<HookHarness options={{ ...geometryOptions, enabled: false }} />);
      });

      expect(hookResult.keyboardLift).toBe(0);

      act(() => tree.unmount());
    });
  });
});
