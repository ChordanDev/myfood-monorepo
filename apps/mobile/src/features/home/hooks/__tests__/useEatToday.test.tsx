/// <reference types="node" />
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MealPlanEntry } from '@/types/domain';
import { useMealPlanStore } from '@/store';
import { useEatToday } from '../useEatToday';

// The calendar API module is the real one: these tests watch the requests the hook really makes,
// so a move that goes back to replacing the range fails here.
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

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const API_URL = 'https://api.example.test';
const MOVE_URL = `${API_URL}/api/calendar/meals/m2/move`;

const params = {
  sourceDate: '2026-10-10',
  sourceType: 'dinner' as const,
  targetDate: '2026-10-09',
  targetType: 'lunch' as const,
};

const entries: MealPlanEntry[] = [
  { id: 'm1', date: '2026-10-09', type: 'lunch', recipeId: 'r1', isCooked: false },
  { id: 'm2', date: '2026-10-10', type: 'dinner', recipeId: 'r2', isCooked: false },
];

const calendarAfterMove = {
  data: {
    startDate: 'a',
    endDate: 'b',
    today: '2026-10-09',
    meals: [
      {
        mealId: 'm2',
        date: '2026-10-09',
        slot: 'lunch',
        recipeId: 'r2',
        recipeName: 'Soup',
        isFavorite: false,
        isCooked: false,
        selectedQuantity: null,
        prepTimeMinutes: null,
        macros: { calories: null },
      },
    ],
  },
};

const moveAnswer = {
  data: {
    moved: { mealId: 'm2', date: '2026-10-09', slot: 'lunch' },
    displaced: { mealId: 'm1', date: '2026-10-10', slot: 'dinner' },
  },
};

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

interface SentRequest {
  method: string;
  url: string;
  body: unknown;
}

const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

function sentRequests(): SentRequest[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    method: init.method,
    url,
    body: init.body ? JSON.parse(init.body) : undefined,
  }));
}

// Answers the move and the calendar read apart, so each test decides how the server reacts.
function serverAnswers({
  move = () => jsonResponse(moveAnswer),
  calendar = () => jsonResponse(calendarAfterMove),
}: { move?: () => Promise<Response>; calendar?: () => Promise<Response> } = {}) {
  fetchMock.mockImplementation((_url: string, init: RequestInit) =>
    init.method === 'GET' ? calendar() : move()
  );
}

let eatToday: ReturnType<typeof useEatToday>;

function Harness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result.
  eatToday = useEatToday();
  return null;
}

beforeEach(() => {
  mockSecureStore.clear();
  mockSecureStore.set('auth_access_token', 'access-1');
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = API_URL;
  serverAnswers();
  useMealPlanStore.setState({ entries });
  act(() => {
    create(<Harness />);
  });
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

describe('useEatToday', () => {
  it('moves the meal by id with one POST and never replaces the range', async () => {
    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    const requests = sentRequests();
    const writes = requests.filter((request) => request.method !== 'GET');

    expect(moved).toBe(true);
    expect(writes).toEqual([
      { method: 'POST', url: MOVE_URL, body: { date: '2026-10-09', slot: 'lunch' } },
    ]);
    expect(requests.filter((request) => request.url.includes('/api/calendar/meals/range'))).toEqual(
      []
    );
  });

  it('takes the plan from the calendar read after the move', async () => {
    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    const requests = sentRequests();

    expect(moved).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(['POST', 'GET']);
    expect(requests[1].url).toContain(`${API_URL}/api/calendar?startDate=`);
    expect(useMealPlanStore.getState().entries).toEqual([
      expect.objectContaining({ id: 'm2', date: '2026-10-09', type: 'lunch' }),
    ]);
  });

  it('reports the move as done when the calendar read after it fails', async () => {
    serverAnswers({ calendar: () => jsonResponse({ data: { meals: 'none' } }) });

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(true);
    expect(useMealPlanStore.getState().entries).toEqual(entries);
  });

  it('reads the plan again when the server refuses the move', async () => {
    // The cached meal is gone on the server: the plan there is not the cached one any more.
    serverAnswers({
      move: () =>
        jsonResponse({ error: { code: 'scheduled_meal_not_found', message: 'Gone' } }, 404),
    });

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(false);
    expect(sentRequests().map((request) => request.method)).toEqual(['POST', 'GET']);
    expect(useMealPlanStore.getState().entries).toEqual([
      expect.objectContaining({ id: 'm2', date: '2026-10-09', type: 'lunch' }),
    ]);
  });

  it('gives up without reading the calendar when the device is offline', async () => {
    // The move could not be sent, so the server's plan is the cached one and a calendar read
    // would only make the User wait for the same failure.
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(false);
    expect(sentRequests().map((request) => request.method)).toEqual(['POST']);
    expect(useMealPlanStore.getState().entries).toEqual(entries);
  });

  it('reads the plan again when the answer to the move is lost', async () => {
    // A timeout leaves open whether the server moved the meal: its plan settles it.
    serverAnswers({
      move: () => Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
    });

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(false);
    expect(sentRequests().map((request) => request.method)).toEqual(['POST', 'GET']);
    expect(useMealPlanStore.getState().entries).toEqual([
      expect.objectContaining({ id: 'm2', date: '2026-10-09', type: 'lunch' }),
    ]);
  });

  it('sends nothing when the move is not allowed', async () => {
    useMealPlanStore.setState({ entries: [{ ...entries[1], isCooked: true }] });

    let moved: boolean | undefined;
    await act(async () => {
      moved = await eatToday(params);
    });

    expect(moved).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
