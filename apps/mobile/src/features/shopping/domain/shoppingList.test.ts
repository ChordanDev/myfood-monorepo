import {
  getDefaultUntilDate,
  getShoppingCounters,
  getUntilCalendar,
  resolveUntilDate,
} from './shoppingList';

// What a read says the list can reach: three days, over two months.
const PLANNED_DATES = ['2026-10-08', '2026-10-10', '2026-11-02'];

describe('getDefaultUntilDate', () => {
  it('is the last planned date', () => {
    expect(getDefaultUntilDate(PLANNED_DATES)).toBe('2026-11-02');
    expect(getDefaultUntilDate(['2026-10-08'])).toBe('2026-10-08');
  });

  it('is no date when nothing is planned', () => {
    expect(getDefaultUntilDate([])).toBeUndefined();
  });
});

describe('resolveUntilDate', () => {
  it('is the last planned date while no day is chosen', () => {
    expect(resolveUntilDate(PLANNED_DATES, undefined)).toBe('2026-11-02');
  });

  it('is the chosen day while it is one of the planned dates', () => {
    expect(resolveUntilDate(PLANNED_DATES, '2026-10-10')).toBe('2026-10-10');
    expect(resolveUntilDate(PLANNED_DATES, '2026-10-08')).toBe('2026-10-08');
  });

  it('goes back to the last planned date when the chosen day is not one of them', () => {
    // A day that lost its meals, one that passed for the server, one that never had any.
    for (const chosen of ['2026-10-09', '2026-10-01', '2026-12-25']) {
      expect(resolveUntilDate(PLANNED_DATES, chosen)).toBe('2026-11-02');
    }
  });

  it('has no date when nothing is planned, whatever was chosen', () => {
    expect(resolveUntilDate([], undefined)).toBeUndefined();
    expect(resolveUntilDate([], '2026-10-10')).toBeUndefined();
  });
});

describe('getUntilCalendar', () => {
  it('lets exactly the planned dates be picked', () => {
    const calendar = getUntilCalendar(PLANNED_DATES);

    for (const date of PLANNED_DATES) {
      expect(calendar?.isDateSelectable(date)).toBe(true);
    }
    for (const date of ['2026-10-07', '2026-10-09', '2026-10-11', '2026-11-03']) {
      expect(calendar?.isDateSelectable(date)).toBe(false);
    }
  });

  it('agrees with the rule that resolves the date of the list', () => {
    const calendar = getUntilCalendar(PLANNED_DATES);

    for (const date of ['2026-10-08', '2026-10-09', '2026-10-10', '2026-11-02', '2026-11-03']) {
      expect(calendar?.isDateSelectable(date)).toBe(resolveUntilDate(PLANNED_DATES, date) === date);
    }
  });

  it('marks the planned dates, and no other day', () => {
    expect(getUntilCalendar(PLANNED_DATES)?.markedDates).toEqual(PLANNED_DATES);
  });

  it('walks only the months that hold a planned date', () => {
    expect(getUntilCalendar(PLANNED_DATES)?.monthBounds).toEqual({
      months: ['2026-10', '2026-11'],
    });
  });

  it('starts the stretch the list buys for on the first planned date', () => {
    expect(getUntilCalendar(PLANNED_DATES)?.rangeStart).toBe('2026-10-08');
  });

  it('never starts that stretch after the date the list reaches', () => {
    const calendar = getUntilCalendar(PLANNED_DATES);

    for (const chosen of [undefined, ...PLANNED_DATES]) {
      const untilDate = resolveUntilDate(PLANNED_DATES, chosen);

      expect(untilDate !== undefined && calendar!.rangeStart <= untilDate).toBe(true);
    }
  });

  it('is no calendar at all when nothing is planned: there is no day to pick', () => {
    expect(getUntilCalendar([])).toBeUndefined();
  });

  it('is a calendar as soon as one day is planned', () => {
    expect(getUntilCalendar(['2026-10-08'])).toEqual(
      expect.objectContaining({
        markedDates: ['2026-10-08'],
        monthBounds: { months: ['2026-10'] },
        rangeStart: '2026-10-08',
      })
    );
  });
});

describe('getShoppingCounters', () => {
  it('counts the listed lines, the ones in the cart among them, and the removed ones apart', () => {
    expect(getShoppingCounters({ needed: 5, inCart: 1, removed: 2, estimatedCents: 0 })).toEqual({
      total: 6,
      inCart: 1,
      removed: 2,
    });
  });

  it('counts nothing for an empty read', () => {
    expect(getShoppingCounters({ needed: 0, inCart: 0, removed: 0, estimatedCents: 0 })).toEqual({
      total: 0,
      inCart: 0,
      removed: 0,
    });
  });
});
