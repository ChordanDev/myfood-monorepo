import { PLANNER_CHAT_INPUT_MAX_LINES, PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT } from '../constants';

export type ComposerLayout = 'inline' | 'stacked';

const COMPOSER_MIN_VISIBLE_LINES = 2;

export function resolveComposerLayout(value: string, probeLines: number): ComposerLayout {
  // The probe reports after the commit, so its count is stale right after the value is cleared.
  if (value === '') return 'inline';
  // iOS measures a trailing newline as a single line, so explicit newlines decide on their own.
  if (value.includes('\n')) return 'stacked';

  return probeLines > 1 ? 'stacked' : 'inline';
}

export function resolveComposerMaxLines(lineHeight: number): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return PLANNER_CHAT_INPUT_MAX_LINES;

  // Whole native lines that fit in the viewport the design reserves at the default font scale.
  const linesInDesignViewport = Math.floor(
    (PLANNER_CHAT_INPUT_MAX_LINES * PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT) / lineHeight
  );

  return Math.min(
    PLANNER_CHAT_INPUT_MAX_LINES,
    Math.max(COMPOSER_MIN_VISIBLE_LINES, linesInDesignViewport)
  );
}
