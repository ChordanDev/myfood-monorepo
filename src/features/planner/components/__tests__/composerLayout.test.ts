import { PLANNER_CHAT_INPUT_MAX_LINES, PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT } from '../../constants';
import { resolveComposerLayout, resolveComposerMaxLines } from '../composerLayout';

const DESIGN_VIEWPORT_HEIGHT = PLANNER_CHAT_INPUT_MAX_LINES * PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT;

describe('resolveComposerLayout', () => {
  it.each([
    { value: '', probeLines: 1, expected: 'inline' },
    { value: 'Short text', probeLines: 1, expected: 'inline' },
    { value: '   ', probeLines: 1, expected: 'inline' },
    { value: 'Text wide enough to wrap between the controls', probeLines: 2, expected: 'stacked' },
    { value: 'Text that wraps many times', probeLines: 7, expected: 'stacked' },
  ])('resolves $expected for "$value" measured at $probeLines line(s)', (testCase) => {
    expect(resolveComposerLayout(testCase.value, testCase.probeLines)).toBe(testCase.expected);
  });

  it('keeps an empty value inline while the probe still holds a stale wrapped count', () => {
    expect(resolveComposerLayout('', 3)).toBe('inline');
  });

  it('stacks on an explicit newline even when the probe reports a single line', () => {
    // iOS reports "abc\n" as one line, so the newline has to decide on its own.
    expect(resolveComposerLayout('abc\n', 1)).toBe('stacked');
    expect(resolveComposerLayout('\n', 1)).toBe('stacked');
    expect(resolveComposerLayout('first\nsecond', 1)).toBe('stacked');
  });
});

describe('resolveComposerMaxLines', () => {
  it('keeps the design line count at the design line height', () => {
    expect(resolveComposerMaxLines(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)).toBe(
      PLANNER_CHAT_INPUT_MAX_LINES
    );
  });

  it('never exceeds the design line count for a shorter line', () => {
    expect(resolveComposerMaxLines(20)).toBe(PLANNER_CHAT_INPUT_MAX_LINES);
    expect(resolveComposerMaxLines(1)).toBe(PLANNER_CHAT_INPUT_MAX_LINES);
  });

  // 393dpi, 450dpi and 374dpi screens round the 24dp design line up to a whole pixel.
  it.each([24.02, 24.18, 24.39])(
    'keeps the design line count when pixel rounding makes a default line %pdp tall',
    (lineHeight) => {
      expect(resolveComposerMaxLines(lineHeight)).toBe(PLANNER_CHAT_INPUT_MAX_LINES);
    }
  );

  it('drops a line once the font scale, not pixel rounding, makes the line taller', () => {
    // 25.2dp is the native line at a 1.05 font scale.
    expect(resolveComposerMaxLines(25.2)).toBe(9);
  });

  it.each([
    { lineHeight: 26.4, expected: 9 },
    { lineHeight: 27.81, expected: 8 },
    { lineHeight: 31.2, expected: 7 },
    { lineHeight: 36, expected: 6 },
    { lineHeight: 48, expected: 5 },
    { lineHeight: 85.7, expected: 2 },
    { lineHeight: 120, expected: 2 },
  ])('fits $expected whole lines of $lineHeight into the design viewport', (testCase) => {
    const maxLines = resolveComposerMaxLines(testCase.lineHeight);

    expect(maxLines).toBe(testCase.expected);
    expect(maxLines * testCase.lineHeight).toBeLessThanOrEqual(DESIGN_VIEWPORT_HEIGHT);
  });

  it('keeps two lines visible when a single line is larger than half the design viewport', () => {
    expect(resolveComposerMaxLines(130)).toBe(2);
    expect(resolveComposerMaxLines(500)).toBe(2);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -24])(
    'falls back to the design line count for the unusable line height %p',
    (lineHeight) => {
      expect(resolveComposerMaxLines(lineHeight)).toBe(PLANNER_CHAT_INPUT_MAX_LINES);
    }
  );
});
