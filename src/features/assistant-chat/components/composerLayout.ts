import { CHAT_COMPOSER_MAX_LINES, CHAT_COMPOSER_TEXT_LINE_HEIGHT } from '../constants';

export type ComposerLayout = 'inline' | 'stacked';

const COMPOSER_MIN_VISIBLE_LINES = 2;
// A native line is rounded up to whole pixels, so at the default font scale it can be a fraction
// of a point taller than the design line. Without this slack those screens would lose a line.
const COMPOSER_LINE_ROUNDING_SLACK = 0.75;

export function resolveComposerLayout(value: string, probeLines: number): ComposerLayout {
  // The probe reports after the commit, so its count is stale right after the value is cleared.
  if (value === '') return 'inline';
  // iOS measures a trailing newline as a single line, so explicit newlines decide on their own.
  if (value.includes('\n')) return 'stacked';

  return probeLines > 1 ? 'stacked' : 'inline';
}

export function resolveComposerMaxLines(lineHeight: number): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return CHAT_COMPOSER_MAX_LINES;

  // Whole native lines that fit in the viewport the design reserves at the default font scale.
  const linesInDesignViewport = Math.floor(
    (CHAT_COMPOSER_MAX_LINES * (CHAT_COMPOSER_TEXT_LINE_HEIGHT + COMPOSER_LINE_ROUNDING_SLACK)) /
      lineHeight
  );

  return Math.min(
    CHAT_COMPOSER_MAX_LINES,
    Math.max(COMPOSER_MIN_VISIBLE_LINES, linesInDesignViewport)
  );
}
