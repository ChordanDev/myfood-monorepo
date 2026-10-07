/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { FloatingCalendarProps } from '@/features/home';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import type { ShoppingUntilCalendar } from '../types';
import { ShoppingDatePill } from './ShoppingDatePill';

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

// Only the surface the pill uses: the barrel would load every shared component.
jest.mock('@/components', () => ({
  ShadowSurface: jest.requireActual('@/components/ShadowSurface').ShadowSurface,
}));

jest.mock('lucide-react-native', () => ({ Calendar: 'Calendar' }));

const mockFloatingCalendars: FloatingCalendarProps[] = [];
const mockAnchorRef: { current: unknown } = { current: null };
const mockAnchor = { x: 14, y: 60, width: 150, height: 42 };

// The calendar itself is the Home feature's: the pill is tested for what it hands it. The
// anchor opens with a fixed frame, since a Jest view measures nothing.
jest.mock('@/features/home', () => {
  const { useState } = require('react');

  return {
    FloatingCalendar: (props: FloatingCalendarProps) => {
      mockFloatingCalendars.push(props);
      return null;
    },
    useFloatingCalendarAnchor: () => {
      const [anchor, setAnchor] = useState(null);

      return {
        anchorRef: mockAnchorRef,
        anchor,
        open: () => setAnchor(mockAnchor),
        close: () => setAnchor(null),
      };
    },
  };
});

const mockTheme = { colorBlack: '#050505', primaryAccent: '#ff6600' };

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

// Returns the colors as the style and records the calls, so the palette animation can be seen.
jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: jest.fn((colors: object) => colors),
}));

const CALENDAR: ShoppingUntilCalendar = {
  planByDate: { '2026-10-12': [] },
  isDateSelectable: (dateKey) => dateKey === '2026-10-12',
  monthBounds: { months: ['2026-10'] },
};

function renderPill() {
  const onSelectDate = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ShoppingDatePill
        label="Hasta 12 Oct"
        untilDate="2026-10-12"
        calendar={CALENDAR}
        onSelectDate={onSelectDate}
      />
    );
  });

  return { root: tree!.root, onSelectDate };
}

function getButton(root: ReactTestInstance) {
  const [button] = root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );

  return button;
}

function pressPill(root: ReactTestInstance) {
  act(() => {
    getButton(root).props.onPress();
  });
}

// What the pill hands the calendar on its last render.
function calendar() {
  return mockFloatingCalendars[mockFloatingCalendars.length - 1];
}

beforeEach(() => {
  mockFloatingCalendars.length = 0;
  mockAnchorRef.current = null;
  jest.mocked(useAnimatedThemeStyle).mockClear();
});

describe('ShoppingDatePill', () => {
  it('shows the day the list reaches', () => {
    const { root } = renderPill();

    expect(root.findByType(Text).props.children).toBe('Hasta 12 Oct');
  });

  it('is a button that says what it does and the day it shows', () => {
    const { root } = renderPill();

    expect(getButton(root).props.accessibilityLabel).toBe(
      'Elegir hasta qué día comprar, ahora 12 Oct'
    );
    expect(getButton(root).props.accessibilityState).toEqual({ expanded: false });
  });

  it('takes its colors from the palette, animated with it', () => {
    renderPill();

    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ backgroundColor: mockTheme.colorBlack });
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ color: mockTheme.primaryAccent });
  });

  it('keeps the calendar closed until it is pressed', () => {
    renderPill();

    expect(calendar().anchor).toBeNull();
  });

  it('opens the calendar under itself when pressed', () => {
    const { root } = renderPill();

    pressPill(root);

    expect(calendar().anchor).toEqual(mockAnchor);
    expect(getButton(root).props.accessibilityState).toEqual({ expanded: true });
  });

  it('is the view the calendar is anchored to, kept measurable on Android', () => {
    const { root } = renderPill();

    expect(mockAnchorRef.current).not.toBeNull();
    expect(getButton(root).props.collapsable).toBe(false);
  });

  it('hands the calendar the days to pick, their marks and months, and the day it shows', () => {
    const { root } = renderPill();

    pressPill(root);

    expect(calendar()).toEqual(
      expect.objectContaining({
        planByDate: CALENDAR.planByDate,
        isDateSelectable: CALENDAR.isDateSelectable,
        monthBounds: CALENDAR.monthBounds,
        selectedDate: '2026-10-12',
      })
    );
  });

  it('reports the picked day and closes the calendar', () => {
    const { root, onSelectDate } = renderPill();
    pressPill(root);

    act(() => {
      calendar().onSelectDate?.('2026-10-06');
    });

    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-06');
    expect(calendar().anchor).toBeNull();
  });

  it('closes on a tap outside without changing the day', () => {
    const { root, onSelectDate } = renderPill();
    pressPill(root);

    act(() => {
      calendar().onClose();
    });

    expect(calendar().anchor).toBeNull();
    expect(onSelectDate).not.toHaveBeenCalled();
  });
});
