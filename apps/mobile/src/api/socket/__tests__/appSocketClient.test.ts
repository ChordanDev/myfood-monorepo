import { getItemAsync } from 'expo-secure-store';
import { Socket } from 'phoenix';

import { clearSession, persistTokens } from '../../authTokenStore';
import { __resetSocketClientForTests } from '../appSocketClient';
import { getSocketClient } from '../index';
import type { FakeSocket } from '../testing/fakeSocket';

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

const mockSockets: FakeSocket[] = [];

jest.mock('phoenix', () => ({
  Socket: jest.fn((url, options) => {
    const { createFakeSocket } =
      jest.requireActual<typeof import('../testing/fakeSocket')>('../testing/fakeSocket');
    const socket = createFakeSocket(url, options);
    mockSockets.push(socket);
    return socket;
  }),
}));

// Read before any test asks for the client: what importing the module did.
const socketsCreatedOnImport = jest.mocked(Socket).mock.calls.length;
const storageReadsOnImport = jest.mocked(getItemAsync).mock.calls.length;

const fetchMock = jest.fn();

function mockJsonResponse(payload: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function tokens(suffix: string) {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    tokenType: 'Bearer' as const,
  };
}

describe('getSocketClient', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    __resetSocketClientForTests();
    mockSecureStore.clear();
    mockSockets.length = 0;
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterAll(() => {
    __resetSocketClientForTests();
    // Assigning undefined would store the string 'undefined'.
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it('neither creates a socket nor reads the session when the module is imported', () => {
    expect(socketsCreatedOnImport).toBe(0);
    expect(storageReadsOnImport).toBe(0);
  });

  it('returns one client for the app, on the socket endpoint of the API', () => {
    const client = getSocketClient();

    expect(getSocketClient()).toBe(client);
    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0].url).toBe('wss://api.example.test/socket');
    expect(mockSockets[0].connectAttempts).toEqual([]);
  });

  it('connects with the stored access token', async () => {
    await persistTokens(tokens('1'));

    await getSocketClient().connect();

    expect(mockSockets[0].connectAttempts).toEqual([{ token: 'access-1' }]);
  });

  it('refreshes a rejected connect through the shared refresh and reconnects once', async () => {
    await persistTokens(tokens('1'));
    fetchMock.mockReturnValueOnce(mockJsonResponse(tokens('2')));
    await getSocketClient().connect();
    const [socket] = mockSockets;

    socket.failBeforeOpen();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/refresh',
      expect.objectContaining({ body: JSON.stringify({ refreshToken: 'refresh-1' }) })
    );
    expect(socket.disconnectCount).toBe(1);
    expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
  });

  it('stops as unauthenticated when the refresh token is no longer valid', async () => {
    await persistTokens(tokens('1'));
    fetchMock.mockReturnValueOnce(
      mockJsonResponse({ error: { code: 'refresh_token_revoked', message: 'revoked' } }, false, 401)
    );
    const client = getSocketClient();
    await client.connect();
    const [socket] = mockSockets;

    socket.failBeforeOpen();
    await flushPromises();

    expect(client.getStatus()).toBe('unauthenticated');
    expect(socket.connectAttempts).toHaveLength(1);
    expect(mockSecureStore.size).toBe(0);
  });

  it('reconnects when new tokens are persisted and disconnects when the session is cleared', async () => {
    await persistTokens(tokens('1'));
    const client = getSocketClient();
    await client.connect();
    const [socket] = mockSockets;
    socket.open();

    await persistTokens(tokens('2'));
    expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);

    socket.open();
    await clearSession();
    expect(client.getStatus()).toBe('disconnected');
    expect(socket.connectAttempts).toHaveLength(2);
  });
});
