import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type { CalendarMealDestination, CalendarQuery, CalendarRead } from '../types/calendarApi';

const CALENDAR_PATH = '/api/calendar';
const CALENDAR_MEALS_PATH = '/api/calendar/meals';

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
 * Moves a Scheduled meal to another day and slot. A meal already there takes the position the
 * moved one leaves, and both keep their ids: the server finds that meal itself, so nothing of
 * the cached plan is sent.
 */
export async function moveCalendarMeal(
  mealId: string,
  destination: CalendarMealDestination,
  options?: RequestOptions
): Promise<void> {
  await apiClient.post<unknown>(
    `${CALENDAR_MEALS_PATH}/${encodeURIComponent(mealId)}/move`,
    { date: destination.date, slot: destination.slot },
    { ...options, auth: true }
  );
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
