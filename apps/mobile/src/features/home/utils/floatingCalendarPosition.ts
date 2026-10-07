// Frame of the element a floating calendar opens from, in window coordinates: what
// `measureInWindow` reports.
export type FloatingCalendarAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const FLOATING_CALENDAR_LAYOUT = {
  width: 304,
  // Space between the anchor and the calendar.
  gap: 8,
  // The closest the calendar gets to a side of the screen.
  screenMargin: 16,
};

// Where the calendar goes: right under its anchor and aligned to its leading edge, moved back
// inside the screen when it would cross a side.
export function getFloatingCalendarFrame(anchor: FloatingCalendarAnchor, windowWidth: number) {
  const { gap, screenMargin } = FLOATING_CALENDAR_LAYOUT;
  const width = Math.min(FLOATING_CALENDAR_LAYOUT.width, windowWidth - 2 * screenMargin);
  const maxLeft = windowWidth - screenMargin - width;

  return {
    left: Math.min(Math.max(anchor.x, screenMargin), maxLeft),
    top: anchor.y + anchor.height + gap,
    width,
  };
}
