/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import type { FloatingCalendarProps } from '@/features/home';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { useMealPlanStore } from '@/store';
import { PlannerHeader } from '../PlannerHeader';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('lucide-react-native', () => ({ Calendar: 'Calendar', Check: 'Check' }));

const mockFloatingCalendars: FloatingCalendarProps[] = [];
const mockAnchorRef: { current: unknown } = { current: null };
const mockAnchor = { x: 14, y: 60, width: 190, height: 42 };

// The calendar itself is the Home feature's: the header is tested for what it hands it, with
// the pure modules of that feature as they are. The anchor opens with a fixed frame, since a
// Jest view measures nothing.
jest.mock('@/features/home', () => {
  const { useState } = require('react');

  return {
    ...jest.requireActual('@/features/home/constants/calendar'),
    ...jest.requireActual('@/features/home/utils/calendarDate'),
    ...jest.requireActual('@/features/home/utils/calendarRange'),
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

// Today is the 16th. One meal before it and two after: the 18th is the last planned day, so
// the 19th is the first one that can be planned.
const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-09-15', type: 'almuerzo', recipeId: 'r1', isCooked: false },
  { id: 'mp2', date: '2026-09-17', type: 'cena', recipeId: 'r1', isCooked: false },
  { id: 'mp3', date: '2026-09-18', type: 'cena', recipeId: 'r1', isCooked: false },
];

const DEFAULT_LABEL = '19 - 25 Septiembre';
const PILL_ACTION = 'Elegir los días a planificar';

let tree: ReturnType<typeof create> | undefined;

function renderHeader(): ReactTestInstance {
  act(() => {
    tree = create(<PlannerHeader />);
  });

  return tree!.root;
}

function getButtons(root: ReactTestInstance) {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );
}

function getPill(root: ReactTestInstance) {
  const pill = getButtons(root).find((button) =>
    String(button.props.accessibilityLabel).startsWith(PILL_ACTION)
  );

  if (!pill) {
    throw new Error('The date pill is not a button');
  }

  return pill;
}

function pressPill(root: ReactTestInstance) {
  act(() => {
    getPill(root).props.onPress();
  });
}

function getPillText(root: ReactTestInstance) {
  return String(root.findByType(Text).props.children);
}

// What the header hands the calendar on its last render.
function calendar() {
  return mockFloatingCalendars[mockFloatingCalendars.length - 1];
}

function tapDay(dateKey: string) {
  act(() => {
    calendar().onSelectDate?.(dateKey);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 16, 12, 0));
  mockFloatingCalendars.length = 0;
  mockAnchorRef.current = null;
  mockBack.mockClear();
  jest.mocked(useAnimatedThemeStyle).mockClear();
  useMealPlanStore.setState({ entries: PLAN });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

describe('PlannerHeader', () => {
  describe('the date pill', () => {
    it('shows the seven days after the last planned day until a range is picked', () => {
      const root = renderHeader();

      expect(getPillText(root)).toBe(DEFAULT_LABEL);
    });

    it('is a button that says what it does and the range it shows', () => {
      const root = renderHeader();

      expect(getPill(root).props.accessibilityLabel).toBe(`${PILL_ACTION}, ahora ${DEFAULT_LABEL}`);
      expect(getPill(root).props.accessibilityState).toEqual({ expanded: false });
    });

    it('takes its colors from the palette, animated with it', () => {
      renderHeader();

      expect(useAnimatedThemeStyle).toHaveBeenCalledWith({
        backgroundColor: mockTheme.colorBlack,
      });
      expect(useAnimatedThemeStyle).toHaveBeenCalledWith({ color: mockTheme.primaryAccent });
    });

    it('casts its shadow from a view that has a fill of its own', () => {
      const root = renderHeader();
      const style = StyleSheet.flatten(
        typeof getPill(root).props.style === 'function'
          ? getPill(root).props.style({ pressed: false })
          : getPill(root).props.style
      );

      expect(style).toEqual(
        expect.objectContaining({ backgroundColor: mockTheme.colorBlack, elevation: 4 })
      );
    });

    it('is the view the calendar is anchored to, kept measurable on Android', () => {
      const root = renderHeader();

      expect(mockAnchorRef.current).not.toBeNull();
      expect(getPill(root).props.collapsable).toBe(false);
    });

    it('keeps the calendar closed until it is pressed', () => {
      renderHeader();

      expect(calendar().anchor).toBeNull();
    });
  });

  describe('the calendar it opens', () => {
    it('opens under the pill with the range drawn', () => {
      const root = renderHeader();

      pressPill(root);

      expect(calendar().anchor).toEqual(mockAnchor);
      expect(calendar().rangeStart).toBe('2026-09-19');
      expect(calendar().rangeEnd).toBe('2026-09-25');
      expect(getPill(root).props.accessibilityState).toEqual({ expanded: true });
    });

    it('blocks every day up to the last planned one and offers the days after it', () => {
      const root = renderHeader();

      pressPill(root);

      const { isDateSelectable, monthBounds } = calendar();
      expect(isDateSelectable?.('2026-09-15')).toBe(false);
      expect(isDateSelectable?.('2026-09-16')).toBe(false);
      expect(isDateSelectable?.('2026-09-18')).toBe(false);
      expect(isDateSelectable?.('2026-09-19')).toBe(true);
      expect(isDateSelectable?.('2027-02-01')).toBe(true);
      expect(monthBounds).toEqual({ from: '2026-09' });
    });

    it('starts at the next month when the plan reaches the end of this one', () => {
      useMealPlanStore.setState({
        entries: [
          ...PLAN,
          { id: 'mp4', date: '2026-09-30', type: 'cena', recipeId: 'r1', isCooked: false },
        ],
      });
      const root = renderHeader();

      pressPill(root);

      expect(getPillText(root)).toBe('1 - 7 Octubre');
      expect(calendar().monthBounds).toEqual({ from: '2026-10' });
    });

    it('still marks the days from today on that already have meals', () => {
      const root = renderHeader();

      pressPill(root);

      expect(calendar().planByDate).toEqual({
        '2026-09-17': [PLAN[1]],
        '2026-09-18': [PLAN[2]],
      });
    });
  });

  describe('picking a range', () => {
    it('sets the start on the first tap and stays open for the end', () => {
      const root = renderHeader();
      pressPill(root);

      tapDay('2026-09-20');

      expect(calendar().anchor).toEqual(mockAnchor);
      expect(calendar().rangeStart).toBe('2026-09-20');
      expect(calendar().rangeEnd).toBeNull();
      expect(getPillText(root)).toBe('Desde 20 Septiembre');
    });

    it('sets the end on the second tap, shows the range and closes', () => {
      const root = renderHeader();
      pressPill(root);
      tapDay('2026-09-20');

      tapDay('2026-09-28');

      expect(calendar().anchor).toBeNull();
      expect(getPillText(root)).toBe('20 - 28 Septiembre');
      expect(getPill(root).props.accessibilityLabel).toBe(
        `${PILL_ACTION}, ahora 20 - 28 Septiembre`
      );
    });

    it('shortens the months of a range that crosses into the next one', () => {
      const root = renderHeader();
      pressPill(root);
      tapDay('2026-09-28');

      tapDay('2026-10-03');

      expect(getPillText(root)).toBe('28 Sep - 3 Oct');
    });

    it('closes a one-day range when the start is tapped again', () => {
      const root = renderHeader();
      pressPill(root);
      tapDay('2026-09-20');

      tapDay('2026-09-20');

      expect(calendar().anchor).toBeNull();
      expect(getPillText(root)).toBe('20 Septiembre');
    });

    it('moves the start, and stays open, when the second tap lands before it', () => {
      const root = renderHeader();
      pressPill(root);
      tapDay('2026-09-22');

      tapDay('2026-09-19');

      expect(calendar().anchor).toEqual(mockAnchor);
      expect(calendar().rangeStart).toBe('2026-09-19');
      expect(calendar().rangeEnd).toBeNull();
    });

    it('starts a new range when it is opened again with a complete one', () => {
      const root = renderHeader();
      pressPill(root);
      tapDay('2026-09-20');
      tapDay('2026-09-28');

      pressPill(root);
      tapDay('2026-09-22');

      expect(calendar().anchor).toEqual(mockAnchor);
      expect(calendar().rangeStart).toBe('2026-09-22');
      expect(calendar().rangeEnd).toBeNull();
    });
  });

  describe('a tap outside the calendar', () => {
    it('closes it and keeps the range as it was', () => {
      const root = renderHeader();
      pressPill(root);

      act(() => {
        calendar().onClose();
      });

      expect(calendar().anchor).toBeNull();
      expect(getPillText(root)).toBe(DEFAULT_LABEL);
    });

    it('keeps a start without an end, and the next opening continues from it', () => {
      const root = renderHeader();
      pressPill(root);
      tapDay('2026-09-20');

      act(() => {
        calendar().onClose();
      });

      expect(calendar().anchor).toBeNull();
      expect(getPillText(root)).toBe('Desde 20 Septiembre');
      expect(getPill(root).props.accessibilityLabel).toBe(
        `${PILL_ACTION}, ahora desde 20 Septiembre`
      );

      pressPill(root);

      expect(calendar().rangeStart).toBe('2026-09-20');
      expect(calendar().rangeEnd).toBeNull();

      tapDay('2026-09-25');

      expect(calendar().anchor).toBeNull();
      expect(getPillText(root)).toBe('20 - 25 Septiembre');
    });
  });

  it('still goes back from its close button', () => {
    const root = renderHeader();
    const closeButton = root
      .findAll((node) => typeof node.props.onPress === 'function')
      .find((node) => !String(node.props.accessibilityLabel).startsWith(PILL_ACTION));

    act(() => {
      closeButton!.props.onPress();
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
