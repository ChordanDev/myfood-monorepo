import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import { useMealPlanStore } from '@/store';
import { useEatToday } from '../useEatToday';

const mockReplaceCalendarRange = jest.fn();
const mockGetCalendar = jest.fn();
jest.mock('../../api/calendarApi', () => ({
  replaceCalendarRange: (...args: unknown[]) => mockReplaceCalendarRange(...args),
  getCalendar: (...args: unknown[]) => mockGetCalendar(...args),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const params = {
  sourceDate: '2026-10-10',
  sourceType: 'dinner' as const,
  targetDate: '2026-10-09',
  targetType: 'lunch' as const,
};

const entries: MealPlanEntry[] = [
  { id: 'm1', date: '2026-10-09', type: 'lunch', recipeId: 'r1', isCooked: false },
  { id: 'm2', date: '2026-10-10', type: 'dinner', recipeId: 'r2', isCooked: false },
];

let eatToday: ReturnType<typeof useEatToday>;

function Harness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result.
  eatToday = useEatToday();
  return null;
}

beforeEach(() => {
  mockReplaceCalendarRange.mockReset().mockResolvedValue(undefined);
  mockGetCalendar.mockReset().mockResolvedValue({
    startDate: 'a',
    endDate: 'b',
    today: '2026-10-09',
    meals: [
      {
        mealId: 'm2',
        date: '2026-10-09',
        slot: 'lunch',
        recipeId: 'r2',
        recipeName: 'Soup',
        isFavorite: false,
        isCooked: false,
        selectedQuantity: null,
        prepTimeMinutes: null,
        macros: { calories: null },
      },
    ],
  });
  useMealPlanStore.setState({ entries });
  act(() => {
    create(<Harness />);
  });
});

describe('useEatToday', () => {
  it('sends the swap to the server and takes the plan from the calendar read', async () => {
    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(true);
    expect(mockReplaceCalendarRange).toHaveBeenCalledWith({
      from: '2026-10-09',
      to: '2026-10-10',
      meals: [
        { date: '2026-10-10', slot: 'dinner', recipeId: 'r1', isCooked: false },
        { date: '2026-10-09', slot: 'lunch', recipeId: 'r2', isCooked: false },
      ],
    });
    expect(useMealPlanStore.getState().entries).toEqual([
      expect.objectContaining({ id: 'm2', date: '2026-10-09', type: 'lunch' }),
    ]);
  });

  it('leaves the cached plan alone when the server refuses the move', async () => {
    mockReplaceCalendarRange.mockRejectedValue(new Error('refused'));

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(false);
    expect(mockGetCalendar).not.toHaveBeenCalled();
    expect(useMealPlanStore.getState().entries).toEqual(entries);
  });

  it('sends nothing when the move is not allowed', async () => {
    useMealPlanStore.setState({ entries: [{ ...entries[1], isCooked: true }] });

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(false);
    expect(mockReplaceCalendarRange).not.toHaveBeenCalled();
  });
});
