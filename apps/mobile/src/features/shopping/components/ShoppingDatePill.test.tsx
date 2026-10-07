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

// The list buys from the 6th; the pill shows it reaching the 12th.
const CALENDAR: ShoppingUntilCalendar = {
  planByDate: { '2026-10-06': [], '2026-10-12': [] },
  isDateSelectable: (dateKey) => dateKey === '2026-10-06' || dateKey === '2026-10-12',
  monthBounds: { months: ['2026-10'] },
  rangeStart: '2026-10-06',
};

function renderPill(
  ...[calendar = CALENDAR, untilDate = '2026-10-12']: [
    calendar?: ShoppingUntilCalendar | null,
    untilDate?: string,
  ]
) {
  const onSelectDate = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <ShoppingDatePill
        label="Hasta 12 Oct"
        untilDate={untilDate}
        calendar={calendar ?? undefined}
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

  it('hands the calendar the days to pick, their marks and their months', () => {
    const { root } = renderPill();

    pressPill(root);

    expect(calendar()).toEqual(
      expect.objectContaining({
        planByDate: CALENDAR.planByDate,
        isDateSelectable: CALENDAR.isDateSelectable,
        monthBounds: CALENDAR.monthBounds,
      })
    );
  });

  it('draws the stretch the list buys for, from its first day to the day it reaches', () => {
    const { root } = renderPill();

    pressPill(root);

    expect(calendar().rangeStart).toBe('2026-10-06');
    expect(calendar().rangeEnd).toBe('2026-10-12');
    // The range is the selection: both ends are drawn as selected by the calendar itself.
    expect(calendar().selectedDate).toBeUndefined();
  });

  it('draws a one-day stretch when the list reaches only its first day', () => {
    const { root } = renderPill(CALENDAR, '2026-10-06');

    pressPill(root);

    expect(calendar().rangeStart).toBe('2026-10-06');
    expect(calendar().rangeEnd).toBe('2026-10-06');
  });

  it('picks the last day with one tap, the first day included, and never a start', () => {
    const { root, onSelectDate } = renderPill();
    pressPill(root);

    act(() => {
      calendar().onSelectDate?.('2026-10-06');
    });

    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-06');
    expect(calendar().anchor).toBeNull();
    expect(calendar().rangeStart).toBe('2026-10-06');
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

describe('ShoppingDatePill without a day to pick', () => {
  it('still shows the day the list reaches, in the colors of the palette', () => {
    const { root } = renderPill(null);

    expect(root.findByType(Text).props.children).toBe('Hasta 12 Oct');
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ backgroundColor: mockTheme.colorBlack });
    expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ color: mockTheme.primaryAccent });
  });

  it('is not a button', () => {
    const { root } = renderPill(null);

    expect(getButton(root)).toBeUndefined();
    expect(root.findAll((node) => typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  it('has no calendar to open', () => {
    renderPill(null);

    expect(mockFloatingCalendars).toHaveLength(0);
  });
});
