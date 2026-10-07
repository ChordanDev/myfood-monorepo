import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import { useMealPlanStore } from '@/store';
import { usePlanningRange } from '../usePlanningRange';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
  ...jest.requireActual('@/features/home/utils/calendarRange'),
}));

const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-09-15', type: 'almuerzo', recipeId: 'r1', isCooked: false },
  { id: 'mp2', date: '2026-09-18', type: 'cena', recipeId: 'r1', isCooked: false },
];

let tree: ReturnType<typeof create> | undefined;
let planning: ReturnType<typeof usePlanningRange>;

function HookHarness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  planning = usePlanningRange();
  return null;
}

function renderPlanningRange() {
  act(() => {
    tree = create(<HookHarness />);
  });
}

// One tap on a day of the calendar; returns the range the hook hands back for it.
function tap(dateKey: string) {
  let returned: ReturnType<typeof planning.selectDate>;

  act(() => {
    returned = planning.selectDate(dateKey);
  });

  return returned!;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 16, 12, 0));
  useMealPlanStore.setState({ entries: PLAN });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

describe('usePlanningRange', () => {
  it('starts with the seven days from today', () => {
    renderPlanningRange();

    expect(planning.range).toEqual({ start: '2026-09-16', end: '2026-09-22' });
  });

  it('lets any day from today on be picked, planned or not, from this month forward', () => {
    renderPlanningRange();

    expect(planning.isDateSelectable('2026-09-16')).toBe(true);
    expect(planning.isDateSelectable('2026-09-18')).toBe(true);
    expect(planning.isDateSelectable('2026-11-30')).toBe(true);
    expect(planning.isDateSelectable('2026-09-15')).toBe(false);
    expect(planning.monthBounds).toEqual({ from: '2026-09' });
  });

  it('marks the days from today on that already have meals', () => {
    renderPlanningRange();

    expect(planning.planByDate).toEqual({ '2026-09-18': [PLAN[1]] });

    act(() => {
      useMealPlanStore.setState({
        entries: [
          ...PLAN,
          { id: 'mp3', date: '2026-09-20', type: 'cena', recipeId: 'r1', isCooked: false },
        ],
      });
    });

    expect(Object.keys(planning.planByDate)).toEqual(['2026-09-18', '2026-09-20']);
  });

  describe('the range gesture', () => {
    it('sets the start on the first tap and waits for the end', () => {
      renderPlanningRange();

      const returned = tap('2026-09-20');

      expect(planning.range).toEqual({ start: '2026-09-20', end: null });
      expect(returned).toEqual(planning.range);
    });

    it('sets the end on a second tap after the start', () => {
      renderPlanningRange();
      tap('2026-09-20');

      const returned = tap('2026-10-03');

      expect(planning.range).toEqual({ start: '2026-09-20', end: '2026-10-03' });
      expect(returned).toEqual(planning.range);
    });

    it('closes a one-day range when the second tap lands on the start', () => {
      renderPlanningRange();
      tap('2026-09-20');

      tap('2026-09-20');

      expect(planning.range).toEqual({ start: '2026-09-20', end: '2026-09-20' });
    });

    it('moves the start when the second tap lands before it', () => {
      renderPlanningRange();
      tap('2026-09-20');

      tap('2026-09-17');

      expect(planning.range).toEqual({ start: '2026-09-17', end: null });
    });

    it('starts a new range from a tap on a complete one, the default one included', () => {
      renderPlanningRange();

      tap('2026-09-18');

      expect(planning.range).toEqual({ start: '2026-09-18', end: null });
    });
  });
});
