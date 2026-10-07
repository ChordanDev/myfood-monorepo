/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import {
  FloatingCalendar,
  useFloatingCalendarAnchor,
  type FloatingCalendarProps,
} from '../FloatingCalendar';
import { FLOATING_CALENDAR_LAYOUT } from '../../utils/floatingCalendarPosition';
import type { CalendarProps } from '../../types/calendar';

const mockCalendars: CalendarProps[] = [];

jest.mock('../Calendar', () => ({
  Calendar: (props: CalendarProps) => {
    mockCalendars.push(props);
    return null;
  },
}));

type TimingCallback = (finished: boolean) => void;

const mockUseReducedMotion = jest.fn(() => false);
const mockWithTiming = jest.fn();
// A test fills this to hold the animations and finish them by hand; otherwise they end at once.
let mockHeldAnimations: TimingCallback[] | null = null;

jest.mock('react-native-reanimated', () => {
  const { useState } = require('react');
  const { View } = require('react-native');

  return {
    __esModule: true,
    default: { View },
    Easing: { cubic: 'cubic', in: (easing: unknown) => easing, out: (easing: unknown) => easing },
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: () => mockUseReducedMotion(),
    // One value per component, as the real hook: the effect that animates depends on it.
    useSharedValue: (initialValue: number) => {
      const [sharedValue] = useState(() => {
        const created = {
          value: initialValue,
          get: () => created.value,
          set: (nextValue: number) => {
            created.value = nextValue;
          },
        };

        return created;
      });

      return sharedValue;
    },
    withTiming: (toValue: number, config: object, callback?: TimingCallback) => {
      mockWithTiming(toValue);

      if (callback) {
        if (mockHeldAnimations) {
          mockHeldAnimations.push(callback);
        } else {
          callback(true);
        }
      }

      return toValue;
    },
  };
});

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

const ANCHOR = { x: 24, y: 100, width: 160, height: 42 };

function renderFloatingCalendar(overrides: Partial<FloatingCalendarProps> = {}) {
  const onClose = jest.fn();
  const onSelectDate = jest.fn();
  const props: FloatingCalendarProps = { anchor: ANCHOR, onClose, onSelectDate, ...overrides };
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<FloatingCalendar {...props} />);
  });

  return {
    root: tree!.root,
    onClose,
    onSelectDate,
    rerender: (nextOverrides: Partial<FloatingCalendarProps>) => {
      act(() => {
        tree.update(<FloatingCalendar {...props} {...nextOverrides} />);
      });
    },
  };
}

function findDialog(root: ReactTestInstance) {
  return root.findAll(
    (node) => node.props.role === 'dialog' && typeof node.type === 'string'
  )[0] as ReactTestInstance | undefined;
}

function getDialog(root: ReactTestInstance) {
  const dialog = findDialog(root);

  if (!dialog) {
    throw new Error('The floating calendar is not on screen');
  }

  return dialog;
}

function getBackdrop(root: ReactTestInstance) {
  return root.findAll(
    (node) => node.props.accessibilityLabel === 'Cerrar' && typeof node.props.onPress === 'function'
  )[0];
}

function lastCalendar() {
  return mockCalendars[mockCalendars.length - 1];
}

describe('FloatingCalendar', () => {
  beforeEach(() => {
    mockCalendars.length = 0;
    mockHeldAnimations = null;
    mockUseReducedMotion.mockReturnValue(false);
    mockWithTiming.mockClear();
  });

  it('shows nothing without an anchor', () => {
    const { root } = renderFloatingCalendar({ anchor: null });

    expect(findDialog(root)).toBeUndefined();
    expect(mockCalendars).toHaveLength(0);
  });

  it('opens right under its anchor, aligned to its leading edge', () => {
    const { root } = renderFloatingCalendar();

    expect(StyleSheet.flatten(getDialog(root).props.style)).toEqual(
      expect.objectContaining({
        left: ANCHOR.x,
        position: 'absolute',
        top: ANCHOR.y + ANCHOR.height + FLOATING_CALENDAR_LAYOUT.gap,
        width: FLOATING_CALENDAR_LAYOUT.width,
      })
    );
  });

  it('stays inside the screen when its anchor is near the trailing edge', () => {
    const { root } = renderFloatingCalendar({ anchor: { ...ANCHOR, x: 300 } });
    const style = StyleSheet.flatten(getDialog(root).props.style);

    expect(style.left + style.width).toBe(390 - FLOATING_CALENDAR_LAYOUT.screenMargin);
  });

  it('renders over the whole screen in a transparent modal', () => {
    const { root } = renderFloatingCalendar();
    const modal = root.findByType(Modal);

    expect(modal.props.transparent).toBe(true);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.statusBarTranslucent).toBe(true);
  });

  it('announces the surface as a modal dialog', () => {
    const { root } = renderFloatingCalendar();

    expect(getDialog(root).props.accessibilityViewIsModal).toBe(true);
  });

  it('hands the calendar its rules and sizes it to its content', () => {
    const planByDate = { '2026-08-25': [] };
    const isDateSelectable = () => true;
    const monthBounds = { from: '2026-08' };

    renderFloatingCalendar({
      planByDate,
      selectedDate: '2026-08-25',
      isDateSelectable,
      monthBounds,
      rangeStart: '2026-08-26',
      rangeEnd: '2026-08-29',
    });

    expect(lastCalendar()).toEqual(
      expect.objectContaining({
        planByDate,
        selectedDate: '2026-08-25',
        isDateSelectable,
        monthBounds,
        rangeStart: '2026-08-26',
        rangeEnd: '2026-08-29',
        sizing: 'content',
      })
    );
  });

  it('reports a picked day and leaves closing to its caller', () => {
    const { onClose, onSelectDate } = renderFloatingCalendar();

    act(() => {
      lastCalendar().onSelectDate?.('2026-08-27');
    });

    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith('2026-08-27');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from a tap outside', () => {
    const { root, onClose } = renderFloatingCalendar();
    const backdrop = getBackdrop(root);

    expect(backdrop.props.accessibilityRole).toBe('button');

    act(() => {
      backdrop.props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the hardware back button', () => {
    const { root, onClose } = renderFloatingCalendar();

    act(() => {
      root.findByType(Modal).props.onRequestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('motion', () => {
    it('animates in when it opens', () => {
      renderFloatingCalendar();

      expect(mockWithTiming).toHaveBeenCalledTimes(1);
      expect(mockWithTiming).toHaveBeenCalledWith(1);
    });

    it('stays where it was while it animates out, and takes no more taps', () => {
      mockHeldAnimations = [];
      const { root, rerender } = renderFloatingCalendar();

      rerender({ anchor: null });

      expect(mockWithTiming).toHaveBeenLastCalledWith(0);
      expect(StyleSheet.flatten(getDialog(root).props.style)).toEqual(
        expect.objectContaining({ left: ANCHOR.x })
      );
      expect(getDialog(root).props.pointerEvents).toBe('none');

      act(() => {
        mockHeldAnimations!.forEach((finish) => finish(true));
      });

      expect(findDialog(root)).toBeUndefined();
    });

    it('stays on screen when it opens again before it finished closing', () => {
      mockHeldAnimations = [];
      const { root, rerender } = renderFloatingCalendar();

      rerender({ anchor: null });
      const interrupted = [...mockHeldAnimations];
      rerender({ anchor: ANCHOR });

      // Reanimated reports the animation it replaced as not finished.
      act(() => {
        interrupted.forEach((finish) => finish(false));
      });

      expect(getDialog(root).props.pointerEvents).toBe('auto');
    });

    it('appears and disappears at once under reduced motion', () => {
      mockUseReducedMotion.mockReturnValue(true);
      const { root, rerender } = renderFloatingCalendar();

      expect(StyleSheet.flatten(getDialog(root).props.style)).toEqual(
        expect.objectContaining({ left: ANCHOR.x })
      );

      rerender({ anchor: null });

      expect(findDialog(root)).toBeUndefined();
      expect(mockWithTiming).not.toHaveBeenCalled();
    });
  });
});

describe('useFloatingCalendarAnchor', () => {
  type Harness = ReturnType<typeof useFloatingCalendarAnchor>;

  function renderAnchorHook() {
    const result: { current: Harness | null } = { current: null };

    function Probe() {
      const harness = useFloatingCalendarAnchor();
      result.current = harness;

      return <View ref={harness.anchorRef} collapsable={false} />;
    }

    act(() => {
      create(<Probe />);
    });

    // The Jest View measures nothing: it is given the frame a device would report.
    const measureInWindow = jest
      .spyOn(result.current!.anchorRef.current!, 'measureInWindow')
      .mockImplementation((callback) => callback(ANCHOR.x, ANCHOR.y, ANCHOR.width, ANCHOR.height));

    return { result, measureInWindow };
  }

  it('starts closed', () => {
    const { result } = renderAnchorHook();

    expect(result.current!.anchor).toBeNull();
  });

  it('opens with the window frame of its element', () => {
    const { result, measureInWindow } = renderAnchorHook();

    act(() => {
      result.current!.open();
    });

    expect(measureInWindow).toHaveBeenCalledTimes(1);
    expect(result.current!.anchor).toEqual(ANCHOR);
  });

  it('closes', () => {
    const { result } = renderAnchorHook();

    act(() => {
      result.current!.open();
    });
    act(() => {
      result.current!.close();
    });

    expect(result.current!.anchor).toBeNull();
  });
});
