import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import { useMealPlanStore } from '@/store';
import { usePlanningRange } from '../usePlanningRange';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home/hooks/useLoadLivePlan', () => ({ useLoadLivePlan: jest.fn() }));

jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
  ...jest.requireActual('@/features/home/utils/calendarRange'),
}));

// Today is the 16th. One meal before it and one after: the 18th is the last planned day, so
// the 19th is the first one that can be planned.
const PLAN: MealPlanEntry[] = [
  { id: 'mp1', date: '2026-09-15', type: 'lunch', recipeId: 'r1', isCooked: false },
  { id: 'mp2', date: '2026-09-18', type: 'dinner', recipeId: 'r1', isCooked: false },
];

function planMeal(date: string) {
  act(() => {
    useMealPlanStore.setState((state) => ({
      entries: [
        ...state.entries,
        { id: `mp-${date}`, date, type: 'dinner', recipeId: 'r1', isCooked: false },
      ],
    }));
  });
}

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
  it('starts with the seven days after the last planned day', () => {
    renderPlanningRange();

    expect(planning.range).toEqual({ start: '2026-09-19', end: '2026-09-25' });
  });

  it('starts today when nothing is planned from today on', () => {
    useMealPlanStore.setState({ entries: [PLAN[0]] });

    renderPlanningRange();

    expect(planning.range).toEqual({ start: '2026-09-16', end: '2026-09-22' });
    expect(planning.isDateSelectable('2026-09-16')).toBe(true);
    expect(planning.isDateSelectable('2026-09-15')).toBe(false);
  });

  it('blocks every day up to the last planned one, planned or not', () => {
    renderPlanningRange();

    expect(planning.isDateSelectable('2026-09-16')).toBe(false);
    expect(planning.isDateSelectable('2026-09-17')).toBe(false);
    expect(planning.isDateSelectable('2026-09-18')).toBe(false);
    expect(planning.isDateSelectable('2026-09-19')).toBe(true);
    expect(planning.isDateSelectable('2026-11-30')).toBe(true);
  });

  it('walks the months from the one of the first plannable day', () => {
    renderPlanningRange();

    expect(planning.monthBounds).toEqual({ from: '2026-09' });

    planMeal('2026-09-30');

    expect(planning.monthBounds).toEqual({ from: '2026-10' });
  });

  it('marks the days from today on that already have meals, which cannot be picked', () => {
    renderPlanningRange();

    expect(planning.planByDate).toEqual({ '2026-09-18': [PLAN[1]] });
    expect(planning.isDateSelectable('2026-09-18')).toBe(false);

    planMeal('2026-09-20');

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

      const returned = tap('2026-09-24');

      expect(planning.range).toEqual({ start: '2026-09-20', end: '2026-09-24' });
      expect(returned).toEqual(planning.range);
    });

    it('cuts a range longer than a week to its seventh day', () => {
      renderPlanningRange();
      tap('2026-09-28');

      const returned = tap('2026-10-20');

      expect(planning.range).toEqual({ start: '2026-09-28', end: '2026-10-04' });
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
      tap('2026-09-22');

      tap('2026-09-19');

      expect(planning.range).toEqual({ start: '2026-09-19', end: null });
    });

    it('starts a new range from a tap on a complete one, the default one included', () => {
      renderPlanningRange();

      tap('2026-09-21');

      expect(planning.range).toEqual({ start: '2026-09-21', end: null });
    });

    it('takes two taps that arrive before a render as the start and the end', () => {
      renderPlanningRange();
      const selectDate = planning.selectDate;
      let first: ReturnType<typeof selectDate>;
      let second: ReturnType<typeof selectDate>;

      act(() => {
        first = selectDate('2026-09-20');
        second = selectDate('2026-09-24');
      });

      expect(first!).toEqual({ start: '2026-09-20', end: null });
      expect(second!).toEqual({ start: '2026-09-20', end: '2026-09-24' });
      expect(planning.range).toEqual({ start: '2026-09-20', end: '2026-09-24' });
    });

    it('hands out the same action on every render', () => {
      renderPlanningRange();
      const selectDate = planning.selectDate;

      tap('2026-09-20');

      expect(planning.selectDate).toBe(selectDate);
    });
  });

  describe('a plan that grows while the Planner is open', () => {
    it('moves the default range after the new last planned day', () => {
      renderPlanningRange();

      planMeal('2026-09-21');

      expect(planning.range).toEqual({ start: '2026-09-22', end: '2026-09-28' });
    });

    it('keeps a picked range that still starts after the last planned day', () => {
      renderPlanningRange();
      tap('2026-09-23');
      tap('2026-09-26');

      planMeal('2026-09-21');

      expect(planning.range).toEqual({ start: '2026-09-23', end: '2026-09-26' });
    });

    it('drops a picked range the plan has reached, for the default one', () => {
      renderPlanningRange();
      tap('2026-09-20');
      tap('2026-09-26');

      planMeal('2026-09-21');

      expect(planning.range).toEqual({ start: '2026-09-22', end: '2026-09-28' });
      expect(planning.isDateSelectable('2026-09-21')).toBe(false);
    });

    it('drops a start without an end the plan has reached, and the next tap starts over', () => {
      renderPlanningRange();
      tap('2026-09-20');

      planMeal('2026-09-20');

      expect(planning.range).toEqual({ start: '2026-09-21', end: '2026-09-27' });

      tap('2026-09-23');

      expect(planning.range).toEqual({ start: '2026-09-23', end: null });
    });
  });
});
