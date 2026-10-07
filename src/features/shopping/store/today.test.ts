import { getTodayKey } from './today';

describe('getTodayKey', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes the local day as a date key, padded like the plan writes its dates', () => {
    expect(getTodayKey(new Date(2026, 9, 7, 12, 30))).toBe('2026-10-07');
    expect(getTodayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('stays on the local day until midnight', () => {
    expect(getTodayKey(new Date(2026, 9, 7, 23, 59, 59))).toBe('2026-10-07');
    expect(getTodayKey(new Date(2026, 9, 8, 0, 0, 0))).toBe('2026-10-08');
  });

  it('reads the clock when it is given no moment', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 7, 23, 59, 59));

    expect(getTodayKey()).toBe('2026-10-07');

    jest.setSystemTime(new Date(2026, 9, 8, 0, 0, 0));

    expect(getTodayKey()).toBe('2026-10-08');
  });
});
