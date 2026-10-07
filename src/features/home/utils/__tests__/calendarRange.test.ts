import {
  EMPTY_CALENDAR_RANGE,
  isBetweenRangeEdges,
  isDateInRange,
  isRangeComplete,
  isRangeEdge,
  selectRangeDate,
} from '../calendarRange';

describe('selectRangeDate', () => {
  it('sets the start on the first tap', () => {
    expect(selectRangeDate(EMPTY_CALENDAR_RANGE, '2026-09-16')).toEqual({
      start: '2026-09-16',
      end: null,
    });
  });

  it('sets the end on a second tap after the start', () => {
    expect(selectRangeDate({ start: '2026-09-16', end: null }, '2026-09-24')).toEqual({
      start: '2026-09-16',
      end: '2026-09-24',
    });
  });

  it('closes a one-day range when the second tap lands on the start', () => {
    expect(selectRangeDate({ start: '2026-09-16', end: null }, '2026-09-16')).toEqual({
      start: '2026-09-16',
      end: '2026-09-16',
    });
  });

  it('moves the start when the second tap lands before it', () => {
    expect(selectRangeDate({ start: '2026-09-16', end: null }, '2026-09-10')).toEqual({
      start: '2026-09-10',
      end: null,
    });
  });

  it('starts a new range when the range was complete', () => {
    const complete = { start: '2026-09-16', end: '2026-09-24' };

    expect(selectRangeDate(complete, '2026-09-20')).toEqual({ start: '2026-09-20', end: null });
    expect(selectRangeDate(complete, '2026-09-02')).toEqual({ start: '2026-09-02', end: null });
    expect(selectRangeDate(complete, '2026-10-01')).toEqual({ start: '2026-10-01', end: null });
  });

  it('orders the days across months and years', () => {
    expect(selectRangeDate({ start: '2026-09-28', end: null }, '2026-10-03')).toEqual({
      start: '2026-09-28',
      end: '2026-10-03',
    });
    expect(selectRangeDate({ start: '2026-12-30', end: null }, '2027-01-02')).toEqual({
      start: '2026-12-30',
      end: '2027-01-02',
    });
  });

  it('does not change the range it receives', () => {
    const range = { start: '2026-09-16', end: null };

    selectRangeDate(range, '2026-09-24');

    expect(range).toEqual({ start: '2026-09-16', end: null });
  });
});

describe('isRangeComplete', () => {
  it('is complete only with both ends', () => {
    expect(isRangeComplete(EMPTY_CALENDAR_RANGE)).toBe(false);
    expect(isRangeComplete({ start: '2026-09-16', end: null })).toBe(false);
    expect(isRangeComplete({ start: '2026-09-16', end: '2026-09-16' })).toBe(true);
  });
});

describe('range membership', () => {
  const range = { start: '2026-09-28', end: '2026-10-03' };

  it('tells the two ends apart from the days between them', () => {
    expect(isRangeEdge('2026-09-28', range)).toBe(true);
    expect(isRangeEdge('2026-10-03', range)).toBe(true);
    expect(isRangeEdge('2026-09-30', range)).toBe(false);

    expect(isBetweenRangeEdges('2026-09-30', range)).toBe(true);
    expect(isBetweenRangeEdges('2026-10-01', range)).toBe(true);
    expect(isBetweenRangeEdges('2026-09-28', range)).toBe(false);
    expect(isBetweenRangeEdges('2026-10-03', range)).toBe(false);
  });

  it('includes both ends and nothing outside them', () => {
    expect(isDateInRange('2026-09-28', range)).toBe(true);
    expect(isDateInRange('2026-10-01', range)).toBe(true);
    expect(isDateInRange('2026-10-03', range)).toBe(true);
    expect(isDateInRange('2026-09-27', range)).toBe(false);
    expect(isDateInRange('2026-10-04', range)).toBe(false);
  });

  it('holds only the start while the end is not chosen', () => {
    const open = { start: '2026-09-16', end: null };

    expect(isRangeEdge('2026-09-16', open)).toBe(true);
    expect(isDateInRange('2026-09-16', open)).toBe(true);
    expect(isDateInRange('2026-09-17', open)).toBe(false);
    expect(isBetweenRangeEdges('2026-09-17', open)).toBe(false);
  });

  it('holds nothing when the range is empty', () => {
    expect(isRangeEdge('2026-09-16', EMPTY_CALENDAR_RANGE)).toBe(false);
    expect(isDateInRange('2026-09-16', EMPTY_CALENDAR_RANGE)).toBe(false);
  });
});
