import { COOKING_TIME_SLOTS } from '../constants/preferenceOptions';

describe('COOKING_TIME_SLOTS', () => {
  it('lists breakfast, lunch and dinner in the order the screens show them', () => {
    expect(COOKING_TIME_SLOTS).toEqual(['breakfast', 'lunch', 'dinner']);
  });
});
