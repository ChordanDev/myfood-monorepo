import type { MealPlanEntry } from '@/types/domain';
import {
  formatPlanningRangeButtonLabel,
  formatPlanningRangeLabel,
  getDefaultPlanningRange,
  getPlannedDaysFrom,
  getPlanningMonthBounds,
  isPlannableDate,
} from '../planningRange';

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
}));

function buildEntry(id: string, date: string): MealPlanEntry {
  return { id, date, type: 'almuerzo', recipeId: 'r1', isCooked: false };
}

describe('getDefaultPlanningRange', () => {
  it('is the seven days starting today', () => {
    expect(getDefaultPlanningRange('2026-09-16')).toEqual({
      start: '2026-09-16',
      end: '2026-09-22',
    });
  });

  it('crosses into the next month and the next year', () => {
    expect(getDefaultPlanningRange('2026-09-28')).toEqual({
      start: '2026-09-28',
      end: '2026-10-04',
    });
    expect(getDefaultPlanningRange('2026-12-29')).toEqual({
      start: '2026-12-29',
      end: '2027-01-04',
    });
  });
});

describe('isPlannableDate', () => {
  it('lets any day from today on be picked, and no earlier one', () => {
    expect(isPlannableDate('2026-09-16', '2026-09-16')).toBe(true);
    expect(isPlannableDate('2026-09-17', '2026-09-16')).toBe(true);
    expect(isPlannableDate('2027-01-01', '2026-09-16')).toBe(true);
    expect(isPlannableDate('2026-09-15', '2026-09-16')).toBe(false);
    expect(isPlannableDate('2025-12-31', '2026-09-16')).toBe(false);
  });
});

describe('getPlanningMonthBounds', () => {
  it('goes from the month of today forward', () => {
    expect(getPlanningMonthBounds('2026-09-16')).toEqual({ from: '2026-09' });
    expect(getPlanningMonthBounds('2026-12-31')).toEqual({ from: '2026-12' });
  });
});

describe('getPlannedDaysFrom', () => {
  it('groups the meals planned from today on by their day', () => {
    const entries = [
      buildEntry('e1', '2026-09-15'),
      buildEntry('e2', '2026-09-16'),
      buildEntry('e3', '2026-09-20'),
      buildEntry('e4', '2026-09-16'),
    ];

    expect(getPlannedDaysFrom(entries, '2026-09-16')).toEqual({
      '2026-09-16': [entries[1], entries[3]],
      '2026-09-20': [entries[2]],
    });
  });

  it('has no day for an empty plan', () => {
    expect(getPlannedDaysFrom([], '2026-09-16')).toEqual({});
  });
});

describe('formatPlanningRangeLabel', () => {
  it('writes both days and the month once when the range stays in one month', () => {
    expect(formatPlanningRangeLabel({ start: '2026-09-16', end: '2026-09-24' })).toBe(
      '16 - 24 Septiembre'
    );
    expect(formatPlanningRangeLabel({ start: '2026-01-01', end: '2026-01-07' })).toBe(
      '1 - 7 Enero'
    );
  });

  it('writes each day with its short month when the range crosses months', () => {
    expect(formatPlanningRangeLabel({ start: '2026-09-28', end: '2026-10-03' })).toBe(
      '28 Sep - 3 Oct'
    );
  });

  it('keeps the short months when the range crosses into another year', () => {
    expect(formatPlanningRangeLabel({ start: '2026-12-29', end: '2027-01-04' })).toBe(
      '29 Dic - 4 Ene'
    );
    // The same month of another year is not the same month.
    expect(formatPlanningRangeLabel({ start: '2026-09-20', end: '2027-09-05' })).toBe(
      '20 Sep - 5 Sep'
    );
  });

  it('says where the range starts while it has no end', () => {
    expect(formatPlanningRangeLabel({ start: '2026-09-16', end: null })).toBe(
      'Desde 16 Septiembre'
    );
  });

  it('writes a single day once', () => {
    expect(formatPlanningRangeLabel({ start: '2026-09-16', end: '2026-09-16' })).toBe(
      '16 Septiembre'
    );
  });

  it('asks for the days while there is no range', () => {
    expect(formatPlanningRangeLabel({ start: null, end: null })).toBe('Elegir días');
  });

  it('has a short form for every month', () => {
    const shortMonths = Array.from({ length: 12 }, (_, month) => {
      const key = String(month + 1).padStart(2, '0');

      return formatPlanningRangeLabel({ start: `2026-${key}-01`, end: '2027-06-01' }).split(' ')[1];
    });

    expect(shortMonths).toEqual([
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ]);
  });
});

describe('formatPlanningRangeButtonLabel', () => {
  it('says what the pill does and the range it shows', () => {
    expect(formatPlanningRangeButtonLabel({ start: '2026-09-16', end: '2026-09-24' })).toBe(
      'Elegir los días a planificar, ahora 16 - 24 Septiembre'
    );
    expect(formatPlanningRangeButtonLabel({ start: '2026-09-16', end: null })).toBe(
      'Elegir los días a planificar, ahora desde 16 Septiembre'
    );
  });

  it('only says what the pill does while there is no range', () => {
    expect(formatPlanningRangeButtonLabel({ start: null, end: null })).toBe(
      'Elegir los días a planificar'
    );
  });
});
