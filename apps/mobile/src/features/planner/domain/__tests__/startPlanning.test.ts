import {
  buildStartPlanningParams,
  isPlanningRequestTooLong,
  MAX_PLANNING_REQUEST_CHARS,
} from '../startPlanning';

describe('buildStartPlanningParams', () => {
  it('sends the first and last day of the range with the request id', () => {
    expect(
      buildStartPlanningParams({ start: '2030-01-01', end: '2030-01-07' }, '', 'req-1', [])
    ).toEqual({ rangeFrom: '2030-01-01', rangeTo: '2030-01-07', requestId: 'req-1' });
  });

  it('treats a range with only its start as that one day', () => {
    expect(buildStartPlanningParams({ start: '2030-01-03', end: null }, '', 'req-1', [])).toEqual({
      rangeFrom: '2030-01-03',
      rangeTo: '2030-01-03',
      requestId: 'req-1',
    });
  });

  it('adds the trimmed request, and leaves a blank one out', () => {
    const range = { start: '2030-01-01', end: '2030-01-02' };

    expect(buildStartPlanningParams(range, '  vegetariano  ', 'req-1', [])).toMatchObject({
      request: 'vegetariano',
    });
    expect(buildStartPlanningParams(range, '   ', 'req-1', [])).not.toHaveProperty('request');
  });

  it('adds the preselected favorites in the order given, and leaves the key out when none is selected', () => {
    const range = { start: '2030-01-01', end: '2030-01-02' };

    expect(buildStartPlanningParams(range, '', 'req-1', ['recipe-b', 'recipe-a'])).toEqual({
      rangeFrom: '2030-01-01',
      rangeTo: '2030-01-02',
      requestId: 'req-1',
      favoriteRecipeIds: ['recipe-b', 'recipe-a'],
    });
    expect(buildStartPlanningParams(range, '', 'req-1', [])).not.toHaveProperty(
      'favoriteRecipeIds'
    );
  });

  it('is null when no day is picked', () => {
    expect(buildStartPlanningParams({ start: null, end: null }, '', 'req-1', [])).toBeNull();
  });
});

describe('isPlanningRequestTooLong', () => {
  it('allows the cap and refuses one character more, after trimming', () => {
    expect(isPlanningRequestTooLong(` ${'x'.repeat(MAX_PLANNING_REQUEST_CHARS)} `)).toBe(false);
    expect(isPlanningRequestTooLong('x'.repeat(MAX_PLANNING_REQUEST_CHARS + 1))).toBe(true);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(isPlanningRequestTooLong('🍝'.repeat(MAX_PLANNING_REQUEST_CHARS))).toBe(false);
  });
});
