/// <reference types="node" />
import { ApiError } from '@/api/errors';
import { getCalendar, moveCalendarMeal } from './calendarApi';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

describe('calendar API', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    mockSecureStore.clear();
    mockSecureStore.set('auth_access_token', 'access-1');
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  describe('getCalendar', () => {
    const body = {
      data: { startDate: '2026-09-07', endDate: '2027-01-06', today: '2026-10-08', meals: [] },
    };

    it('reads the window with the access token', async () => {
      fetchMock.mockReturnValue(jsonResponse(body));

      const calendar = await getCalendar({ startDate: '2026-09-07', endDate: '2027-01-06' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.example.test/api/calendar?startDate=2026-09-07&endDate=2027-01-06'
      );
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer access-1');
      expect(calendar.today).toBe('2026-10-08');
    });

    it('rejects an answer without the members of a calendar read', async () => {
      fetchMock.mockReturnValue(jsonResponse({ data: { meals: 'none' } }));

      await expect(
        getCalendar({ startDate: '2026-09-07', endDate: '2027-01-06' })
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('moveCalendarMeal', () => {
    it('posts the destination to the move route of the meal', async () => {
      fetchMock.mockReturnValue(
        jsonResponse({
          data: { moved: { mealId: 'm 2', date: '2026-10-08', slot: 'lunch' }, displaced: null },
        })
      );

      await expect(
        moveCalendarMeal('m 2', { date: '2026-10-08', slot: 'lunch' })
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/calendar/meals/m%202/move');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer access-1');
      expect(JSON.parse(init.body)).toEqual({ date: '2026-10-08', slot: 'lunch' });
    });

    it('rejects with the code of the envelope when the server refuses the move', async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ error: { code: 'scheduled_meal_cooked', message: 'Cooked' } }, 409)
      );

      const refusal = await moveCalendarMeal('m2', { date: '2026-10-08', slot: 'lunch' }).catch(
        (error: unknown) => error
      );

      expect(refusal).toBeInstanceOf(ApiError);
      expect(refusal).toMatchObject({ code: 'scheduled_meal_cooked', status: 409 });
    });
  });
});
