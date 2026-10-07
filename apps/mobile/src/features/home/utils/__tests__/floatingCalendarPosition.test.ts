import { FLOATING_CALENDAR_LAYOUT, getFloatingCalendarFrame } from '../floatingCalendarPosition';

const { gap, screenMargin, width } = FLOATING_CALENDAR_LAYOUT;
const WINDOW_WIDTH = 390;

function anchorAt(x: number) {
  return { x, y: 100, width: 160, height: 42 };
}

describe('getFloatingCalendarFrame', () => {
  it('opens right under the anchor, aligned to its leading edge', () => {
    expect(getFloatingCalendarFrame(anchorAt(24), WINDOW_WIDTH)).toEqual({
      left: 24,
      top: 100 + 42 + gap,
      width,
    });
  });

  it('moves back inside when the anchor is too close to the trailing edge', () => {
    const frame = getFloatingCalendarFrame(anchorAt(300), WINDOW_WIDTH);

    expect(frame.left).toBe(WINDOW_WIDTH - screenMargin - width);
    expect(frame.left + frame.width).toBeLessThanOrEqual(WINDOW_WIDTH - screenMargin);
  });

  it('keeps the margin when the anchor touches the leading edge', () => {
    expect(getFloatingCalendarFrame(anchorAt(0), WINDOW_WIDTH).left).toBe(screenMargin);
  });

  it('narrows to a window that cannot hold its width', () => {
    const narrowWindow = width;
    const frame = getFloatingCalendarFrame(anchorAt(40), narrowWindow);

    expect(frame).toEqual({
      left: screenMargin,
      top: 100 + 42 + gap,
      width: narrowWindow - 2 * screenMargin,
    });
  });
});
