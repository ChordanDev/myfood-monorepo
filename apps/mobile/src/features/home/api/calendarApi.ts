import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type { CalendarQuery, CalendarRangeReplacement, CalendarRead } from '../types/calendarApi';

const CALENDAR_PATH = '/api/calendar';
const CALENDAR_RANGE_PATH = '/api/calendar/meals/range';

/**
 * Reads the meals the Account has scheduled between two dates (both included). The server's
 * "today" comes back with the answer, so no date of this device decides what is past.
 */
export async function getCalendar(
  { startDate, endDate }: CalendarQuery,
  options?: RequestOptions
): Promise<CalendarRead> {
  const query = `startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const response = await apiClient.get<unknown>(`${CALENDAR_PATH}?${query}`, {
    ...options,
    auth: true,
    retry: options?.retry ?? true,
  });

  return parseCalendarResponse(response);
}

/**
 * Replaces every meal of a range with the given ones. Meals of the range that are not sent are
 * deleted by the server, so a caller sends all the meals it wants to keep.
 */
export async function replaceCalendarRange(
  replacement: CalendarRangeReplacement,
  options?: RequestOptions
): Promise<void> {
  await apiClient.put<unknown>(CALENDAR_RANGE_PATH, replacement, { ...options, auth: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The transport does not check the shape of a 2xx answer, so a body without the members of a
// read is treated like any other unintelligible server answer instead of being cached.
function parseCalendarResponse(response: unknown): CalendarRead {
  const data = isRecord(response) ? response.data : undefined;

  if (
    !isRecord(data) ||
    typeof data.startDate !== 'string' ||
    typeof data.endDate !== 'string' ||
    typeof data.today !== 'string' ||
    !Array.isArray(data.meals) ||
    !data.meals.every(isRecord)
  ) {
    throw new ApiError('unknown_error', 'Malformed calendar response');
  }

  return data as unknown as CalendarRead;
}
