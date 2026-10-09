import type { CalendarRange } from '@/features/home';

/** The params of `start_planning` (apps/api/docs/CHANNELS.md), in camelCase. */
export interface StartPlanningParams {
  rangeFrom: string;
  rangeTo: string;
  requestId: string;
  request?: string;
}

/** The longest request the server takes, after trimming (apps/api/docs/CHANNELS.md). */
export const MAX_PLANNING_REQUEST_CHARS = 1000;

/** Whether the server would refuse `request` as `invalid_payload` for its length. */
export function isPlanningRequestTooLong(request: string): boolean {
  // Code points, as the server counts characters and not UTF-16 units.
  return Array.from(request.trim()).length > MAX_PLANNING_REQUEST_CHARS;
}

/**
 * What to push to start planning `range`, or null while no day is picked. A range with only its
 * start is that one day. A blank request is left out, as the server counts it as none.
 */
export function buildStartPlanningParams(
  range: CalendarRange,
  request: string,
  requestId: string
): StartPlanningParams | null {
  if (range.start === null) return null;

  const text = request.trim();
  return {
    rangeFrom: range.start,
    rangeTo: range.end ?? range.start,
    requestId,
    ...(text === '' ? {} : { request: text }),
  };
}
