/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import { Calendar } from '../Calendar';
import type { DayCellProps } from '../DayCell';

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
