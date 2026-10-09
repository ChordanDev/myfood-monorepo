// AuthContext profile update against the REAL auth service: only the
// network (fetch) and the secure store are faked, so these tests cover
// what a malformed PUT /api/me/profile answer does to `me` end to end.

import { createElement as h } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthContextValue, CurrentMe, ProfileUpdatePayload } from '@/features/auth/types/auth';
import * as authService from '@/services/authService';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';

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

const me: CurrentMe = {
  user: {
    id: 'user-1',
    email: 'user@example.com',
    displayName: 'Lucca',
    householdSize: 2,
    cookingSkill: 'intermediate',
  },
  account: {
    id: 'account-1',
    type: 'individual',
    trialEndsAt: '2099-12-31T00:00:00Z',
    subscriptionStatus: 'none',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    access: { canUseApp: true, reason: null },
  },
  membership: { role: 'owner' },
  onboarding: { isComplete: true },
};

const payload: ProfileUpdatePayload = {
  displayName: 'Lucca Giordana',
  householdSize: 3,
  cookingSkill: 'advanced',
};

function textResponse(text: string, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as Response);
}

// Answers GET /api/me with the signed-in user and the profile PUT with
// whatever body the test supplies.
function stubNetwork(profileResponseText: string, profileStatus = 200) {
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && url.endsWith('/api/me/profile')) {
      return textResponse(profileResponseText, profileStatus);
    }
    return textResponse(JSON.stringify(me));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

function Probe({ renders }: { renders: AuthContextValue[] }) {
  renders.push(useAuth());
  return null;
}

async function flush() {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderSignedIn() {
  const renders: AuthContextValue[] = [];
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(h(AuthProvider, null, h(Probe, { renders })));
  });
  await flush();
  return {
    renders,
    latest: () => renders[renders.length - 1],
    unmount: () => act(() => tree!.unmount()),
  };
}

describe('AuthContext — updateProfile with a malformed server answer', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    mockSecureStore.clear();
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
    await authService.persistSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      me,
    });
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    globalThis.fetch = originalFetch;
  });

  it('rejects with a typed error and keeps me when the update answers with an empty body', async () => {
    stubNetwork('', 204);
    const { latest, renders, unmount } = await renderSignedIn();
    expect(latest().me).toEqual(me);
    const meBefore = latest().me;
    const rendersBefore = renders.length;

    let failure: unknown;
    await act(async () => {
      failure = await latest()
        .updateProfile(payload)
        .catch((error: unknown) => error);
    });
    await flush();

    expect(failure).toBeInstanceOf(authService.AuthApiError);
    expect(failure).toMatchObject({ code: 'unknown_error' });
    expect(latest().me).toBe(meBefore);
    expect(renders.length).toBe(rendersBefore);
    await expect(authService.getStoredSession()).resolves.toMatchObject({ me });

    unmount();
  });

  it('writes null, never undefined, for profile fields the update answer omits', async () => {
    stubNetwork(JSON.stringify({ user: { id: 'user-1', email: 'user@example.com' } }));
    const { latest, unmount } = await renderSignedIn();

    await act(async () => {
      await latest().updateProfile(payload);
    });
    await flush();

    const expectedUser = {
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
      householdSize: null,
      cookingSkill: null,
    };
    expect(latest().me?.user).toStrictEqual(expectedUser);
    const stored = await authService.getStoredSession();
    expect(stored?.me.user).toStrictEqual(expectedUser);

    unmount();
  });
});
