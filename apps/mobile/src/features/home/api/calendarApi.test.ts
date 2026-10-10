/// <reference types="node" />
import { ApiError } from '@/api/errors';
import { getCalendar, replaceCalendarRange } from './calendarApi';

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

  describe('replaceCalendarRange', () => {
    it('puts the range and its meals', async () => {
      fetchMock.mockReturnValue(jsonResponse({ data: { replaced: 1 } }));
      const replacement = {
        from: '2026-10-08',
        to: '2026-10-09',
        meals: [{ date: '2026-10-08', slot: 'lunch' as const, recipeId: 'r1', isCooked: false }],
      };

      await replaceCalendarRange(replacement);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.example.test/api/calendar/meals/range');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual(replacement);
    });

    it('rejects when the server refuses the replacement', async () => {
      fetchMock.mockReturnValue(jsonResponse({ error: 'meal_outside_range' }, 422));

      await expect(
        replaceCalendarRange({ from: '2026-10-08', to: '2026-10-08', meals: [] })
      ).rejects.toBeInstanceOf(ApiError);
    });
  });
});
