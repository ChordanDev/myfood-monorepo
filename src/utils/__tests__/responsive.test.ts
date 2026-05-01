import { clamp, getPhoneSizeBucket, scaleByBucket } from '../responsive';

describe('Responsive Metrics Helpers', () => {
  describe('clamp', () => {
    it('should return value if within range', () => {
      expect(clamp(15, 10, 20)).toBe(15);
    });

    it('should return min if value is below range', () => {
      expect(clamp(5, 10, 20)).toBe(10);
    });

    it('should return max if value is above range', () => {
      expect(clamp(25, 10, 20)).toBe(20);
    });
  });

  describe('getPhoneSizeBucket', () => {
    it('returns xs for very small screens', () => {
      expect(getPhoneSizeBucket(320)).toBe('xs');
    });

    it('returns sm for standard small screens', () => {
      expect(getPhoneSizeBucket(375)).toBe('sm');
    });

    it('returns md for medium screens', () => {
      expect(getPhoneSizeBucket(414)).toBe('md');
    });

    it('returns lg for tablets or very large phones', () => {
      expect(getPhoneSizeBucket(768)).toBe('lg');
    });
  });

  describe('scaleByBucket', () => {
    const values: [number, number, number, number] = [10, 14, 18, 22];

    it('scales correctly for xs bucket', () => {
      expect(scaleByBucket('xs', values)).toBe(10);
    });

    it('scales correctly for sm bucket', () => {
      expect(scaleByBucket('sm', values)).toBe(14);
    });

    it('scales correctly for md bucket', () => {
      expect(scaleByBucket('md', values)).toBe(18);
    });

    it('scales correctly for lg bucket', () => {
      expect(scaleByBucket('lg', values)).toBe(22);
    });
  });
});
