/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import { Calendar } from '../Calendar';
import type { DayCellProps } from '../DayCell';
import type { CalendarProps } from '../../types/calendar';

const mockDayCells: DayCellProps[] = [];

jest.mock('../DayCell', () => ({
  DayCell: (props: DayCellProps) => {
    mockDayCells.push(props);
    return null;
  },
}));

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');

  return { __esModule: true, default: { Text, View } };
});

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

jest.mock('@/components', () => {
  const { View } = require('react-native');

  return { ShadowSurface: View };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#222211',
      colorLight: '#999977',
      textBlack: '#111100',
      textDark: '#111100',
    },
  }),
}));

function entry(overrides: Partial<MealPlanEntry>): MealPlanEntry {
  return {
    id: `${overrides.date}-${overrides.type}`,
    date: '2026-08-25',
    type: 'almuerzo',
    recipeId: 'r1',
    isCooked: false,
    ...overrides,
  };
}

function renderDayCells(planByDate: Record<string, MealPlanEntry[]>) {
  mockDayCells.length = 0;

  act(() => {
    create(<Calendar planByDate={planByDate} selectedDate="2026-08-25" />);
  });

  return (dateString: string) => {
    const cell = mockDayCells.filter((props) => props.dateString === dateString).pop();

    if (!cell) {
      throw new Error(`No day cell rendered for ${dateString}`);
    }

    return cell;
  };
}

function renderCalendar(props: CalendarProps) {
  mockDayCells.length = 0;
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<Calendar {...props} />);
  });

  const root = tree!.root;

  return {
    root,
    getDayCell: (dateString: string) => {
      const cell = mockDayCells.filter((cellProps) => cellProps.dateString === dateString).pop();

      if (!cell) {
        throw new Error(`No day cell rendered for ${dateString}`);
      }

      return cell;
    },
  };
}

function getMonthLabel(root: ReactTestInstance) {
  return root
    .findAllByType(Text)
    .map((node) => String(node.props.children))
    .find((text) => /\d{4}$/.test(text));
}

function getMonthButton(root: ReactTestInstance, label: 'Mes anterior' | 'Mes siguiente') {
  return root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  )[0];
}

function pressMonthButton(root: ReactTestInstance, label: 'Mes anterior' | 'Mes siguiente') {
  act(() => {
    getMonthButton(root, label).props.onPress();
  });
}

function getViewStyles(root: ReactTestInstance) {
  return root.findAllByType(View).map((view) => StyleSheet.flatten(view.props.style) ?? {});
}

describe('Calendar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 25, 12, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const planByDate = {
    '2026-08-21': [entry({ date: '2026-08-21', isCooked: true })],
    '2026-08-22': [entry({ date: '2026-08-22', isSkipped: true })],
    '2026-08-24': [entry({ date: '2026-08-24' })],
    '2026-08-25': [entry({ date: '2026-08-25' })],
    '2026-08-27': [entry({ date: '2026-08-27' })],
  };

  it('shows a past day whose meals are all confirmed like a day without a plan', () => {
    const getDayCell = renderDayCells(planByDate);
    const unplannedDay = getDayCell('2026-08-20');

    for (const dateString of ['2026-08-21', '2026-08-22']) {
      const confirmedDay = getDayCell(dateString);

      expect(confirmedDay.isPlanned).toBe(false);
      expect(confirmedDay.isPendingConfirmation).toBe(false);
      expect(confirmedDay.isSelectable).toBe(false);
      expect(confirmedDay.textColor).toBe(unplannedDay.textColor);
    }
  });

  it('keeps the planned look for today and for upcoming planned days', () => {
    const getDayCell = renderDayCells(planByDate);

    expect(getDayCell('2026-08-25').isPlanned).toBe(true);
    expect(getDayCell('2026-08-27').isPlanned).toBe(true);
    expect(getDayCell('2026-08-28').isPlanned).toBe(false);
  });

  it('marks a past day with an unconfirmed meal as pending', () => {
    const getDayCell = renderDayCells(planByDate);

    expect(getDayCell('2026-08-24').isPendingConfirmation).toBe(true);
  });
});

describe('Calendar with rules from outside', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 25, 12, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const planByDate = {
    '2026-08-24': [entry({ date: '2026-08-24' })],
    '2026-08-25': [entry({ date: '2026-08-25' })],
    '2026-08-27': [entry({ date: '2026-08-27' })],
    '2026-10-02': [entry({ date: '2026-10-02' })],
  };

  const fromTodayOn = (dateString: string) => dateString >= '2026-08-25';

  describe('selectable days', () => {
    it('takes the selectable days from the rule it receives', () => {
      const { getDayCell } = renderCalendar({ planByDate, isDateSelectable: fromTodayOn });

      // A day without a plan, which the plan rule leaves out.
      expect(getDayCell('2026-08-28').isSelectable).toBe(true);
      // A past day with an unconfirmed meal, which the plan rule lets in.
      expect(getDayCell('2026-08-24').isSelectable).toBe(false);
    });

    it('keeps marking the planned days under another rule', () => {
      const { getDayCell } = renderCalendar({ planByDate, isDateSelectable: fromTodayOn });

      expect(getDayCell('2026-08-27').isPlanned).toBe(true);
      expect(getDayCell('2026-08-28').isPlanned).toBe(false);
    });

    it('dims the days the rule leaves out', () => {
      const { getDayCell } = renderCalendar({ planByDate, isDateSelectable: fromTodayOn });

      expect(getDayCell('2026-08-28').textColor).toBe(getDayCell('2026-08-25').textColor);
      expect(getDayCell('2026-08-24').textColor).not.toBe(getDayCell('2026-08-25').textColor);
    });

    it('reports a tapped day only when the rule allows it', () => {
      const onSelectDate = jest.fn();
      const { getDayCell } = renderCalendar({
        planByDate,
        onSelectDate,
        isDateSelectable: fromTodayOn,
      });

      act(() => {
        getDayCell('2026-08-24').onSelect('2026-08-24');
      });

      expect(onSelectDate).not.toHaveBeenCalled();

      act(() => {
        getDayCell('2026-08-28').onSelect('2026-08-28');
      });

      expect(onSelectDate).toHaveBeenCalledTimes(1);
      expect(onSelectDate).toHaveBeenCalledWith('2026-08-28');
    });

    it('selects only the days with something to show by default', () => {
      const { getDayCell } = renderCalendar({ planByDate });

      expect(getDayCell('2026-08-27').isSelectable).toBe(true);
      expect(getDayCell('2026-08-24').isSelectable).toBe(true);
      expect(getDayCell('2026-08-28').isSelectable).toBe(false);
    });
  });

  describe('month bounds', () => {
    it('walks only the months with a plan by default', () => {
      const { root } = renderCalendar({ planByDate });

      expect(getMonthLabel(root)).toBe('Agosto 2026');
      expect(getMonthButton(root, 'Mes anterior').props.disabled).toBe(true);

      pressMonthButton(root, 'Mes siguiente');

      expect(getMonthLabel(root)).toBe('Octubre 2026');
      expect(getMonthButton(root, 'Mes siguiente').props.disabled).toBe(true);
    });

    it('walks only the months it receives', () => {
      const { root } = renderCalendar({
        planByDate,
        monthBounds: { months: ['2026-08', '2026-09'] },
      });

      expect(getMonthLabel(root)).toBe('Agosto 2026');
      expect(getMonthButton(root, 'Mes anterior').props.disabled).toBe(true);

      pressMonthButton(root, 'Mes siguiente');

      expect(getMonthLabel(root)).toBe('Septiembre 2026');
      expect(getMonthButton(root, 'Mes siguiente').props.disabled).toBe(true);

      pressMonthButton(root, 'Mes siguiente');

      expect(getMonthLabel(root)).toBe('Septiembre 2026');

      pressMonthButton(root, 'Mes anterior');

      expect(getMonthLabel(root)).toBe('Agosto 2026');
    });

    it('goes from the first month forward without an upper bound', () => {
      const { root } = renderCalendar({ planByDate, monthBounds: { from: '2026-08' } });

      expect(getMonthLabel(root)).toBe('Agosto 2026');
      expect(getMonthButton(root, 'Mes anterior').props.disabled).toBe(true);
      expect(getMonthButton(root, 'Mes siguiente').props.disabled).toBe(false);

      // Past the last planned month and into the next year.
      for (let presses = 0; presses < 5; presses += 1) {
        pressMonthButton(root, 'Mes siguiente');
      }

      expect(getMonthLabel(root)).toBe('Enero 2027');
      expect(getMonthButton(root, 'Mes siguiente').props.disabled).toBe(false);
      expect(getMonthButton(root, 'Mes anterior').props.disabled).toBe(false);

      pressMonthButton(root, 'Mes anterior');

      expect(getMonthLabel(root)).toBe('Diciembre 2026');
    });

    it('never goes before the first month', () => {
      const { root } = renderCalendar({ planByDate, monthBounds: { from: '2026-08' } });

      pressMonthButton(root, 'Mes anterior');

      expect(getMonthLabel(root)).toBe('Agosto 2026');
    });

    it('opens on the first month when today is before it', () => {
      const { root } = renderCalendar({ planByDate, monthBounds: { from: '2026-11' } });

      expect(getMonthLabel(root)).toBe('Noviembre 2026');
      expect(getMonthButton(root, 'Mes anterior').props.disabled).toBe(true);
    });
  });

  describe('range', () => {
    it('draws the two ends as selected and marks the days between them', () => {
      const { getDayCell } = renderCalendar({
        planByDate,
        isDateSelectable: fromTodayOn,
        rangeStart: '2026-08-26',
        rangeEnd: '2026-08-29',
      });

      expect(getDayCell('2026-08-26').isSelected).toBe(true);
      expect(getDayCell('2026-08-29').isSelected).toBe(true);
      expect(getDayCell('2026-08-26').isInRange).toBe(false);
      expect(getDayCell('2026-08-29').isInRange).toBe(false);

      for (const dateString of ['2026-08-27', '2026-08-28']) {
        expect(getDayCell(dateString).isInRange).toBe(true);
        expect(getDayCell(dateString).isSelected).toBe(false);
      }

      for (const dateString of ['2026-08-25', '2026-08-30']) {
        expect(getDayCell(dateString).isInRange).toBe(false);
        expect(getDayCell(dateString).isSelected).toBe(false);
      }
    });

    it('draws only the start while the end is not chosen', () => {
      const { getDayCell } = renderCalendar({
        planByDate,
        isDateSelectable: fromTodayOn,
        rangeStart: '2026-08-26',
        rangeEnd: null,
      });

      expect(getDayCell('2026-08-26').isSelected).toBe(true);
      expect(getDayCell('2026-08-27').isSelected).toBe(false);
      expect(getDayCell('2026-08-27').isInRange).toBe(false);
    });

    it('leaves the range to its caller: a tap only reports the day', () => {
      const onSelectDate = jest.fn();
      const { getDayCell } = renderCalendar({
        planByDate,
        onSelectDate,
        isDateSelectable: fromTodayOn,
        rangeStart: '2026-08-26',
        rangeEnd: null,
      });

      act(() => {
        getDayCell('2026-08-29').onSelect('2026-08-29');
      });

      expect(onSelectDate).toHaveBeenCalledWith('2026-08-29');
      expect(getDayCell('2026-08-29').isSelected).toBe(false);
      expect(getDayCell('2026-08-27').isInRange).toBe(false);
    });

    it('marks no day as inside a range when there is none', () => {
      const { getDayCell } = renderCalendar({ planByDate, selectedDate: '2026-08-25' });

      expect(getDayCell('2026-08-25').isSelected).toBe(true);
      expect(getDayCell('2026-08-26').isInRange).toBe(false);
    });
  });

  describe('sizing', () => {
    it('fills its parent and scrolls the month by default', () => {
      const { root } = renderCalendar({ planByDate });

      expect(root.findAllByType(ScrollView)).toHaveLength(1);
      expect(getViewStyles(root).some((style) => style.flex === 1)).toBe(true);
    });

    it('takes the height of its content when asked to, so it fits a popover', () => {
      const { root } = renderCalendar({ planByDate, sizing: 'content' });

      expect(root.findAllByType(ScrollView)).toHaveLength(0);
      expect(getViewStyles(root).some((style) => style.flex === 1)).toBe(false);
    });

    it('keeps room for six weeks when sized to its content, so months do not resize it', () => {
      const { root } = renderCalendar({ planByDate, sizing: 'content', daySize: 36 });
      const grid = getViewStyles(root).find((style) => style.flexWrap === 'wrap');

      // Six rows of a 36pt day and its 8pt gap, under the 7pt top padding of the grid.
      expect(grid?.minHeight).toBe(7 + 6 * (36 + 8));
    });
  });
});
