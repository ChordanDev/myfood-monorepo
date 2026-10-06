import { resolveTurnTrailingSpace } from '../turnAnchor';

// A 700dp viewport over a 192dp bottom clearance, with the turn anchored 16dp below its top.
const VIEWPORT_HEIGHT = 700;
const BOTTOM_CLEARANCE = 192;
const TOP_INSET = 16;
const USABLE_VIEWPORT_HEIGHT = VIEWPORT_HEIGHT - BOTTOM_CLEARANCE;
const FULL_RESERVATION = USABLE_VIEWPORT_HEIGHT - TOP_INSET;

const UNMEASURED_POSITIONS = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

function resolve(activeTurnY: number | null, trailingSpaceY: number | null): number {
  return resolveTurnTrailingSpace({
    usableViewportHeight: USABLE_VIEWPORT_HEIGHT,
    topInset: TOP_INSET,
    activeTurnY,
    trailingSpaceY,
  });
}

describe('resolveTurnTrailingSpace', () => {
  it('reserves only what the turn leaves empty below the anchored position', () => {
    // The turn takes 134dp down to the trailing space, out of the 492dp below the anchor.
    expect(FULL_RESERVATION).toBe(492);
    expect(resolve(426, 560)).toBe(358);
  });

  it.each([
    { activeTurnY: 426, trailingSpaceY: 560 },
    { activeTurnY: 426, trailingSpaceY: 588 },
    { activeTurnY: 588, trailingSpaceY: 722 },
    { activeTurnY: 1840.5, trailingSpaceY: 2001.25 },
    { activeTurnY: 426, trailingSpaceY: 917.5 },
  ])(
    'makes the anchored offset the furthest one for a turn from $activeTurnY to $trailingSpaceY',
    ({ activeTurnY, trailingSpaceY }) => {
      const reservation = resolve(activeTurnY, trailingSpaceY);
      const contentHeight = trailingSpaceY + reservation + BOTTOM_CLEARANCE;

      // The furthest offset, the content height minus the viewport, is the anchored one.
      expect(reservation).toBeGreaterThan(0);
      expect(contentHeight).toBe(activeTurnY - TOP_INSET + VIEWPORT_HEIGHT);
    }
  );

  it('gives back exactly what the turn grows by, so the content height does not move', () => {
    const withTypingIndicator = resolve(426, 560);
    const withReply = resolve(426, 588);

    expect(withTypingIndicator - withReply).toBe(28);
    expect(588 + withReply).toBe(560 + withTypingIndicator);
  });

  it.each(UNMEASURED_POSITIONS)(
    'reserves in full while the active turn position is %p',
    (activeTurnY) => {
      expect(resolve(activeTurnY, 560)).toBe(FULL_RESERVATION);
    }
  );

  it.each(UNMEASURED_POSITIONS)(
    'reserves in full while the trailing space position is %p',
    (trailingSpaceY) => {
      expect(resolve(426, trailingSpaceY)).toBe(FULL_RESERVATION);
    }
  );

  it('reserves in full while neither position is measured', () => {
    expect(resolve(null, null)).toBe(FULL_RESERVATION);
  });

  it('reserves in full when the trailing space is reported above the active turn', () => {
    // A layout left over from the previous turn.
    expect(resolve(588, 560)).toBe(FULL_RESERVATION);
    expect(resolve(588, 587.5)).toBe(FULL_RESERVATION);
    expect(resolve(588, -40)).toBe(FULL_RESERVATION);
  });

  it('reserves in full when the trailing space is reported where the turn starts', () => {
    expect(resolve(588, 588)).toBe(FULL_RESERVATION);
  });

  it('keeps reserving until the turn fills the usable viewport', () => {
    expect(resolve(426, 917)).toBe(1);
    expect(resolve(426, 917.75)).toBe(0.25);
  });

  it.each([918, 918.5, 1500, 1e9])(
    'reserves nothing below a turn that ends at %p, past the usable viewport',
    (trailingSpaceY) => {
      expect(resolve(426, trailingSpaceY)).toBe(0);
    }
  );

  it.each([16, 10, 0, -192])(
    'reserves nothing when the usable viewport is %pdp tall',
    (usableViewportHeight) => {
      const input = { usableViewportHeight, topInset: TOP_INSET };

      expect(resolveTurnTrailingSpace({ ...input, activeTurnY: null, trailingSpaceY: null })).toBe(
        0
      );
      expect(resolveTurnTrailingSpace({ ...input, activeTurnY: 426, trailingSpaceY: 560 })).toBe(0);
      expect(resolveTurnTrailingSpace({ ...input, activeTurnY: 588, trailingSpaceY: 560 })).toBe(0);
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'reserves nothing when the usable viewport is the unusable height %p',
    (usableViewportHeight) => {
      const input = { usableViewportHeight, topInset: TOP_INSET };

      expect(resolveTurnTrailingSpace({ ...input, activeTurnY: null, trailingSpaceY: null })).toBe(
        0
      );
      expect(resolveTurnTrailingSpace({ ...input, activeTurnY: 426, trailingSpaceY: 560 })).toBe(0);
    }
  );

  it('never reserves more than the full extent, a negative height or NaN', () => {
    const positions = [...UNMEASURED_POSITIONS, -50, 0, 0.5, 426, 560, 918, 5000];
    const usableViewportHeights = [-100, 0, 16, 16.5, 134, 508, 2000];

    for (const usableViewportHeight of usableViewportHeights) {
      const fullReservation = Math.max(0, usableViewportHeight - TOP_INSET);

      for (const activeTurnY of positions) {
        for (const trailingSpaceY of positions) {
          const reservation = resolveTurnTrailingSpace({
            usableViewportHeight,
            topInset: TOP_INSET,
            activeTurnY,
            trailingSpaceY,
          });

          expect(Number.isFinite(reservation)).toBe(true);
          expect(reservation).toBeGreaterThanOrEqual(0);
          expect(reservation).toBeLessThanOrEqual(fullReservation);
        }
      }
    }
  });
});
