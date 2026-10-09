// AuthContext profile update: the PUT response patches the in-memory
// `me`, so the settings screen reflects a saved value without a second
// /api/me read (which would rotate the tokens and could re-arm the
// refresh effects guarded in AuthContext.loop.test.tsx).
//
// These tests mount the REAL `AuthProvider` against a mocked
// `@/services/authService` and only use the public context API.
//
/* eslint-disable @typescript-eslint/no-require-imports */

import { createElement as h } from 'react';
import { act, create } from 'react-test-renderer';
import type {
  AuthContextValue,
  AuthSession,
  CurrentMe,
  ProfileUpdatePayload,
  ProfileUpdateResponse,
} from '@/features/auth/types/auth';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { useAuth } from '@/features/auth/hooks/useAuth';

const mockAuthService = jest.requireMock('@/services/authService');

jest.mock('@/services/authService', () => require('../fixtures/authServiceMock'));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

function makeMe(user: Partial<CurrentMe['user']> = {}): CurrentMe {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Lucca',
      householdSize: null,
      cookingSkill: null,
      ...user,
    },
    account: {
      id: 'account-1',
      type: 'individual',
      trialEndsAt: '2099-12-31T00:00:00Z',
      subscriptionStatus: 'none',
      timezone: null,
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
  };
}

function makeSession(me: CurrentMe): AuthSession {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', tokenType: 'Bearer', me };
}

const payload: ProfileUpdatePayload = {
  displayName: 'Lucca Giordana',
  householdSize: 2,
  cookingSkill: 'intermediate',
};

const response: ProfileUpdateResponse = {
  user: { id: 'user-1', email: 'user@example.com', ...payload },
};

interface Harness {
  renders: AuthContextValue[];
  latest: () => AuthContextValue;
  unmount: () => void;
}

function Probe({ renders }: { renders: AuthContextValue[] }) {
  renders.push(useAuth());
  return null;
}

async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderSignedIn(me: CurrentMe): Promise<Harness> {
  mockAuthService.restoreSessionWithFreshMe.mockResolvedValue(makeSession(me));
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

describe('AuthContext — updateProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthService.refreshCurrentSession.mockResolvedValue(null);
    mockAuthService.persistProfileForStoredSession.mockResolvedValue(null);
    mockAuthService.clearSession.mockResolvedValue(undefined);
  });

  it('reflects the saved profile on me without re-reading the session', async () => {
    const initialMe = makeMe();
    const { latest, unmount } = await renderSignedIn(initialMe);
    mockAuthService.updateProfile.mockResolvedValue(response);

    let result: ProfileUpdateResponse | undefined;
    await act(async () => {
      result = await latest().updateProfile(payload);
    });
    await flush();

    expect(mockAuthService.updateProfile).toHaveBeenCalledWith(payload);
    expect(result).toEqual(response);
    expect(latest().me).toEqual(makeMe(payload));
    expect(latest().user).toEqual(makeMe(payload).user);
    expect(mockAuthService.refreshCurrentSession).not.toHaveBeenCalled();

    unmount();
  });

  it('writes the saved profile to the stored session', async () => {
    const { latest, unmount } = await renderSignedIn(makeMe());
    mockAuthService.updateProfile.mockResolvedValue(response);

    await act(async () => {
      await latest().updateProfile(payload);
    });

    expect(mockAuthService.persistProfileForStoredSession).toHaveBeenCalledWith(response.user);

    unmount();
  });

  it('keeps the save successful when the stored session cannot be written', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { latest, unmount } = await renderSignedIn(makeMe());
    mockAuthService.updateProfile.mockResolvedValue(response);
    mockAuthService.persistProfileForStoredSession.mockRejectedValue(new Error('storage full'));

    await act(async () => {
      await expect(latest().updateProfile(payload)).resolves.toEqual(response);
    });
    await flush();

    expect(latest().me).toEqual(makeMe(payload));

    warn.mockRestore();
    unmount();
  });

  it('rejects and leaves me untouched when the update fails', async () => {
    const initialMe = makeMe();
    const { latest, renders, unmount } = await renderSignedIn(initialMe);
    const error = new mockAuthService.AuthApiError('unknown_error', 'Not Found', 404);
    mockAuthService.updateProfile.mockRejectedValue(error);
    const rendersBefore = renders.length;

    await act(async () => {
      await expect(latest().updateProfile(payload)).rejects.toBe(error);
    });
    await flush();

    expect(latest().me).toEqual(initialMe);
    expect(renders.length).toBe(rendersBefore);
    expect(mockAuthService.persistProfileForStoredSession).not.toHaveBeenCalled();

    unmount();
  });

  it('re-renders once for a saved change and not at all for an unchanged profile', async () => {
    const { latest, renders, unmount } = await renderSignedIn(makeMe());
    mockAuthService.updateProfile.mockResolvedValue(response);

    const beforeFirstSave = renders.length;
    await act(async () => {
      await latest().updateProfile(payload);
    });
    await flush();
    expect(renders.length - beforeFirstSave).toBe(1);

    const meAfterFirstSave = latest().me;
    const beforeSecondSave = renders.length;
    await act(async () => {
      await latest().updateProfile(payload);
    });
    await flush();

    expect(renders.length).toBe(beforeSecondSave);
    expect(latest().me).toBe(meAfterFirstSave);
    expect(mockAuthService.refreshCurrentSession).not.toHaveBeenCalled();

    unmount();
  });

  it('does not bring me back when the user signed out before the update resolved', async () => {
    const { latest, unmount } = await renderSignedIn(makeMe());
    let resolveUpdate: (value: ProfileUpdateResponse) => void = () => undefined;
    mockAuthService.updateProfile.mockReturnValue(
      new Promise<ProfileUpdateResponse>((resolve) => {
        resolveUpdate = resolve;
      })
    );

    let pendingUpdate: Promise<ProfileUpdateResponse> | undefined;
    await act(async () => {
      pendingUpdate = latest().updateProfile(payload);
      await latest().signOut();
    });
    expect(latest().me).toBeNull();

    await act(async () => {
      resolveUpdate(response);
      await expect(pendingUpdate).resolves.toEqual(response);
    });
    await flush();

    expect(latest().me).toBeNull();
    expect(latest().isAuthenticated).toBe(false);

    unmount();
  });

  it('leaves me untouched when the update answers for a different user', async () => {
    const { latest, renders, unmount } = await renderSignedIn(makeMe());
    const otherUserResponse: ProfileUpdateResponse = {
      user: { ...response.user, id: 'user-2', email: 'other@example.com' },
    };
    mockAuthService.updateProfile.mockResolvedValue(otherUserResponse);
    const meBefore = latest().me;
    const rendersBefore = renders.length;

    await act(async () => {
      await expect(latest().updateProfile(payload)).resolves.toEqual(otherUserResponse);
    });
    await flush();

    expect(latest().me).toBe(meBefore);
    expect(latest().me).toEqual(makeMe());
    expect(renders.length).toBe(rendersBefore);

    unmount();
  });

  it('applies a refreshed me whose only change is a profile field', async () => {
    const { latest, unmount } = await renderSignedIn(makeMe());
    const refreshedMe = makeMe({ householdSize: 4, cookingSkill: 'advanced' });
    mockAuthService.refreshCurrentSession.mockResolvedValue(makeSession(refreshedMe));

    await act(async () => {
      await latest().refreshMe();
    });
    await flush();

    expect(latest().me).toEqual(refreshedMe);

    unmount();
  });
});
