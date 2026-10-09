import type { MealPlanEntry } from '@/types/domain';
import {
  clampPlanningRange,
  formatPlanningRangeButtonLabel,
  formatPlanningStartLabel,
  formatPlanningRangeLabel,
  getDefaultPlanningRange,
  getFirstPlannableDate,
  getPlannedDaysFrom,
  getPlanningMonthBounds,
  isPlannableDate,
  resolvePlanningRange,
} from '../planningRange';

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
}));

function buildEntry(id: string, date: string): MealPlanEntry {
  return { id, date, type: 'lunch', recipeId: 'r1', isCooked: false };
}

describe('getFirstPlannableDate', () => {
  const TODAY = '2026-09-16';

  it('is today when nothing is planned', () => {
    expect(getFirstPlannableDate([], TODAY)).toBe(TODAY);
  });

  it('is today when the plan ended before today', () => {
    const entries = [buildEntry('e1', '2026-09-10'), buildEntry('e2', '2026-09-15')];

    expect(getFirstPlannableDate(entries, TODAY)).toBe(TODAY);
  });

  it('is tomorrow when the last planned day is today', () => {
    expect(getFirstPlannableDate([buildEntry('e1', TODAY)], TODAY)).toBe('2026-09-17');
  });

  it('is the day after the last planned day, wherever it sits in the plan', () => {
    const entries = [
      buildEntry('e1', '2026-09-22'),
      buildEntry('e2', '2026-09-17'),
      buildEntry('e3', '2026-09-20'),
    ];

    expect(getFirstPlannableDate(entries, TODAY)).toBe('2026-09-23');
  });

  it('counts a planned day whose meal was already cooked', () => {
    const cooked = { ...buildEntry('e1', '2026-09-20'), isCooked: true };

    expect(getFirstPlannableDate([cooked], TODAY)).toBe('2026-09-21');
  });

  it('crosses into the next month and the next year', () => {
    expect(getFirstPlannableDate([buildEntry('e1', '2026-09-30')], TODAY)).toBe('2026-10-01');
    expect(getFirstPlannableDate([buildEntry('e1', '2026-12-31')], TODAY)).toBe('2027-01-01');
  });
});

describe('getDefaultPlanningRange', () => {
  it('is the seven days starting on the first plannable day', () => {
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
  it('lets any day from the first plannable one on be picked, and no earlier one', () => {
    expect(isPlannableDate('2026-09-16', '2026-09-16')).toBe(true);
    expect(isPlannableDate('2026-09-17', '2026-09-16')).toBe(true);
    expect(isPlannableDate('2027-01-01', '2026-09-16')).toBe(true);
    expect(isPlannableDate('2026-09-15', '2026-09-16')).toBe(false);
    expect(isPlannableDate('2025-12-31', '2026-09-16')).toBe(false);
  });
});

describe('resolvePlanningRange', () => {
  const FIRST_PLANNABLE = '2026-09-19';
  const DEFAULT_RANGE = { start: '2026-09-19', end: '2026-09-25' };

  it('is the default range while nothing was picked', () => {
    expect(resolvePlanningRange(null, FIRST_PLANNABLE)).toEqual(DEFAULT_RANGE);
  });

  it('is the picked range while it starts on a plannable day', () => {
    const complete = { start: '2026-09-19', end: '2026-09-20' };
    const startOnly = { start: '2026-09-22', end: null };

    expect(resolvePlanningRange(complete, FIRST_PLANNABLE)).toBe(complete);
    expect(resolvePlanningRange(startOnly, FIRST_PLANNABLE)).toBe(startOnly);
  });

  it('goes back to the default range when the plan overtakes the start of the picked one', () => {
    expect(
      resolvePlanningRange({ start: '2026-09-18', end: '2026-09-24' }, FIRST_PLANNABLE)
    ).toEqual(DEFAULT_RANGE);
    expect(resolvePlanningRange({ start: '2026-09-17', end: null }, FIRST_PLANNABLE)).toEqual(
      DEFAULT_RANGE
    );
  });

  it('is the default range for a range without a start', () => {
    expect(resolvePlanningRange({ start: null, end: null }, FIRST_PLANNABLE)).toEqual(
      DEFAULT_RANGE
    );
  });
});

describe('getPlanningMonthBounds', () => {
  it('goes from the month of the first plannable day forward', () => {
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

describe('clampPlanningRange', () => {
  it('keeps a range of up to seven days', () => {
    const range = { start: '2026-09-28', end: '2026-10-04' };

    expect(clampPlanningRange(range)).toBe(range);
  });

  it('moves the end of a longer range back to the seventh day, across a month', () => {
    expect(clampPlanningRange({ start: '2026-09-28', end: '2026-10-20' })).toEqual({
      start: '2026-09-28',
      end: '2026-10-04',
    });
  });

  it('leaves a range without an end alone', () => {
    const range = { start: '2026-09-28', end: null };

    expect(clampPlanningRange(range)).toBe(range);
  });
});

describe('formatPlanningStartLabel', () => {
  it('names the range it will plan', () => {
    expect(formatPlanningStartLabel({ start: '2026-09-16', end: '2026-09-24' })).toBe(
      'Planificar 16 - 24 Septiembre'
    );
  });

  it('names the one day of a range with only its start, which is the span that is sent', () => {
    expect(formatPlanningStartLabel({ start: '2026-09-16', end: null })).toBe(
      'Planificar 16 Septiembre'
    );
  });

  it('is plain while no day is picked', () => {
    expect(formatPlanningStartLabel({ start: null, end: null })).toBe('Planificar');
  });
});
