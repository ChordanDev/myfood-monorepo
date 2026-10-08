import { defaultSlot, defaultSlotCookingTimes } from '../utils/slotCookingTime';

describe('defaultSlotCookingTimes', () => {
  it('gives the default slot to breakfast, lunch and dinner', () => {
    expect(defaultSlotCookingTimes()).toEqual({
      breakfast: defaultSlot(),
      lunch: defaultSlot(),
      dinner: defaultSlot(),
    });
  });

  it('builds every slot apart, so editing one never changes another', () => {
    const times = defaultSlotCookingTimes();

    expect(times.breakfast).not.toBe(times.lunch);
    expect(times.lunch).not.toBe(times.dinner);
    expect(defaultSlotCookingTimes().breakfast).not.toBe(times.breakfast);
  });
});
