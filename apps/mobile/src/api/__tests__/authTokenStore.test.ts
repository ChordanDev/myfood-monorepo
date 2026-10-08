import { clearSession, persistTokens, subscribeToAccessToken } from '../authTokenStore';

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

const tokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer' as const,
};

describe('authTokenStore access token subscription', () => {
  const unsubscribers: (() => void)[] = [];

  function subscribe(listener: (accessToken: string | null) => void): () => void {
    const unsubscribe = subscribeToAccessToken(listener);
    unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  beforeEach(() => {
    mockSecureStore.clear();
  });

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it('notifies listeners with the new access token once tokens are persisted', async () => {
    const listener = jest.fn();
    subscribe(listener);

    await persistTokens(tokens);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('access-1');
  });

  it('notifies after both tokens are stored', async () => {
    const storedWhenNotified: (string | undefined)[] = [];
    subscribe(() => {
      storedWhenNotified.push(
        mockSecureStore.get('auth_access_token'),
        mockSecureStore.get('auth_refresh_token')
      );
    });

    await persistTokens(tokens);

    expect(storedWhenNotified).toEqual(['access-1', 'refresh-1']);
  });

  it('notifies listeners with null when the session is cleared', async () => {
    await persistTokens(tokens);
    const listener = jest.fn();
    subscribe(listener);

    await clearSession();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);

    unsubscribe();
    await persistTokens(tokens);
    await clearSession();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps persisting and notifying the other listeners when one listener throws', async () => {
    const listener = jest.fn();
    subscribe(() => {
      throw new Error('listener failed');
    });
    subscribe(listener);

    await expect(persistTokens(tokens)).resolves.toBeUndefined();
    expect(mockSecureStore.get('auth_access_token')).toBe('access-1');
    expect(mockSecureStore.get('auth_refresh_token')).toBe('refresh-1');

    await expect(clearSession()).resolves.toBeUndefined();
    expect(mockSecureStore.size).toBe(0);

    expect(listener.mock.calls).toEqual([['access-1'], [null]]);
  });
});
