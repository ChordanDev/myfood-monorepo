import { buildLocalMealPlanByDate, isSelectableMealDate } from './localMealPlan';
import { formatDateKey, parseDateKey, startOfDay } from '../utils/calendarDate';

describe('mock meal plan date keys', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 25, 0, 30));
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps today selectable using the local calendar date', () => {
    let mockMealPlan: typeof import('@/mocks/domainMocks').MOCK_MEAL_PLAN;

    jest.isolateModules(() => {
      ({ MOCK_MEAL_PLAN: mockMealPlan } = jest.requireActual('@/mocks/domainMocks'));
    });

    const today = startOfDay(new Date());
    const todayKey = formatDateKey(today);
    const planByDate = buildLocalMealPlanByDate(mockMealPlan!);

    expect(todayKey).toBe('2026-08-25');
    expect(mockMealPlan![0].date).toBe(todayKey);
    expect(isSelectableMealDate(todayKey, planByDate, today, parseDateKey)).toBe(true);
  });
});
