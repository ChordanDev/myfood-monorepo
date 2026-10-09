// AuthContext: the device timezone is sent when it differs from the one
// `me` reports, and `me` is patched from the answer so the comparison
// matches afterwards (no repeated request).
/* eslint-disable @typescript-eslint/no-require-imports */

import { createElement as h } from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthContextValue, AuthSession, CurrentMe } from '@/features/auth/types/auth';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { useAuth } from '@/features/auth/hooks/useAuth';

const mockAuthService = jest.requireMock('@/services/authService');

jest.mock('@/services/authService', () => require('../fixtures/authServiceMock'));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const DEVICE_ZONE = 'America/Argentina/Buenos_Aires';

function makeMe(timezone: string | null): CurrentMe {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
      householdSize: null,
      cookingSkill: null,
    },
    account: {
      id: 'account-1',
      type: 'individual',
      trialEndsAt: '2099-12-31T00:00:00Z',
      subscriptionStatus: 'none',
      timezone,
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
  };
}

function makeSession(me: CurrentMe): AuthSession {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', tokenType: 'Bearer', me };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderSignedIn(me: CurrentMe) {
  mockAuthService.restoreSessionWithFreshMe.mockResolvedValue(makeSession(me));
  const renders: AuthContextValue[] = [];
  function Probe() {
    renders.push(useAuth());
    return null;
  }
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(h(AuthProvider, null, h(Probe)));
  });
  await flush();
  return { latest: () => renders[renders.length - 1], unmount: () => act(() => tree!.unmount()) };
}

describe('AuthContext — account timezone sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: DEVICE_ZONE } as Intl.ResolvedDateTimeFormatOptions);
    mockAuthService.refreshCurrentSession.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends the device zone once and patches me with the stored zone', async () => {
    mockAuthService.updateAccountTimezone.mockResolvedValue({
      account: { id: 'account-1', timezone: DEVICE_ZONE },
    });
    const { latest, unmount } = await renderSignedIn(makeMe('Europe/Madrid'));

    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledTimes(1);
    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledWith({ timezone: DEVICE_ZONE });
    expect(latest().me?.account.timezone).toBe(DEVICE_ZONE);

    unmount();
  });

  it('does not call the API when the reported zone already matches', async () => {
    const { unmount } = await renderSignedIn(makeMe(DEVICE_ZONE));

    expect(mockAuthService.updateAccountTimezone).not.toHaveBeenCalled();

    unmount();
  });

  it('keeps me unchanged when the request fails', async () => {
    mockAuthService.updateAccountTimezone.mockRejectedValue(new Error('offline'));
    const { latest, unmount } = await renderSignedIn(makeMe(null));

    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledTimes(1);
    expect(latest().me?.account.timezone).toBeNull();

    unmount();
  });
});
