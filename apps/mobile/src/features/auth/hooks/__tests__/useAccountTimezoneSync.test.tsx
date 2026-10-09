import { createElement as h } from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { CurrentMe } from '@/features/auth/types/auth';
import { useAccountTimezoneSync } from '../useAccountTimezoneSync';

const mockAuthService = jest.requireMock('@/services/authService');

jest.mock('@/services/authService', () => ({
  __esModule: true,
  updateAccountTimezone: jest.fn(),
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
      trialEndsAt: null,
      subscriptionStatus: 'none',
      timezone,
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
  };
}

function Probe({ me, onSynced }: { me: CurrentMe | null; onSynced: (tz: string) => void }) {
  useAccountTimezoneSync(me, onSynced);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let appStateHandler: ((state: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (state: string) => void
  ) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
  jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ timeZone: DEVICE_ZONE } as Intl.ResolvedDateTimeFormatOptions);
  mockAuthService.updateAccountTimezone.mockResolvedValue({
    account: { id: 'account-1', timezone: DEVICE_ZONE },
  });
});

afterEach(() => jest.restoreAllMocks());

describe('useAccountTimezoneSync', () => {
  it('sends nothing when the zones match', async () => {
    const onSynced = jest.fn();
    act(() => void create(h(Probe, { me: makeMe(DEVICE_ZONE), onSynced })));
    await flush();
    act(() => appStateHandler?.('active'));
    await flush();
    expect(mockAuthService.updateAccountTimezone).not.toHaveBeenCalled();
  });

  it('sends the device zone once when it differs and reports success', async () => {
    const onSynced = jest.fn();
    act(() => void create(h(Probe, { me: makeMe('Europe/Madrid'), onSynced })));
    await flush();
    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledTimes(1);
    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledWith({ timezone: DEVICE_ZONE });
    expect(onSynced).toHaveBeenCalledWith(DEVICE_ZONE);
  });

  it('sends once when the stored zone is null', async () => {
    act(() => void create(h(Probe, { me: makeMe(null), onSynced: jest.fn() })));
    await flush();
    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledTimes(1);
  });

  it('does not send while me is unavailable', async () => {
    act(() => void create(h(Probe, { me: null, onSynced: jest.fn() })));
    await flush();
    act(() => appStateHandler?.('active'));
    await flush();
    expect(mockAuthService.updateAccountTimezone).not.toHaveBeenCalled();
  });

  it('does not start a second request while one is in flight', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockAuthService.updateAccountTimezone.mockReturnValue(new Promise((r) => (resolve = r)));
    act(() => void create(h(Probe, { me: makeMe('Europe/Madrid'), onSynced: jest.fn() })));
    act(() => appStateHandler?.('active'));
    act(() => appStateHandler?.('active'));
    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledTimes(1);
    resolve({ account: { id: 'account-1', timezone: DEVICE_ZONE } });
    await flush();
  });

  it('swallows a failed request and retries on the next foreground', async () => {
    mockAuthService.updateAccountTimezone.mockRejectedValueOnce(new Error('offline'));
    const onSynced = jest.fn();
    act(() => void create(h(Probe, { me: makeMe('Europe/Madrid'), onSynced })));
    await flush();
    expect(onSynced).not.toHaveBeenCalled();
    act(() => appStateHandler?.('active'));
    await flush();
    expect(mockAuthService.updateAccountTimezone).toHaveBeenCalledTimes(2);
    expect(onSynced).toHaveBeenCalledWith(DEVICE_ZONE);
  });

  it('ignores non-active app states', async () => {
    act(() => void create(h(Probe, { me: makeMe('Europe/Madrid'), onSynced: jest.fn() })));
    await flush();
    mockAuthService.updateAccountTimezone.mockClear();
    act(() => appStateHandler?.('background'));
    await flush();
    expect(mockAuthService.updateAccountTimezone).not.toHaveBeenCalled();
  });
});
