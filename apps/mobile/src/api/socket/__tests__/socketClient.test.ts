import { ApiError } from '../../errors';
import { createSocketClient, type SocketStatus } from '../socketClient';
import { createFakeSocket, type FakeSocket } from '../testing/fakeSocket';
import { planningTopic } from '../topics';

const SOCKET_URL = 'wss://api.example.test/socket';
const TOPIC = 'planning:account-1';

function refusal(code: string, message = 'refused') {
  return { error: { code, message } };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface SetupOptions {
  storedToken?: string | null;
  /** Replaces the read of the stored token, for a test that controls when it resolves. */
  getAccessToken?: () => Promise<string | null>;
  /** Makes the first subscription to the token store throw. */
  failFirstSubscription?: boolean;
}

/** Phoenix's backoff starts a new attempt and the server refuses the upgrade again. */
async function failNextAttempt(socket: FakeSocket): Promise<void> {
  socket.backoffRetry();
  socket.failBeforeOpen();
  await flushPromises();
}

function setup({
  storedToken = 'access-1',
  getAccessToken,
  failFirstSubscription = false,
}: SetupOptions = {}) {
  let token = storedToken;
  let subscriptionFails = failFirstSubscription;
  let now = 1_700_000_000_000;
  const tokenListeners = new Set<(accessToken: string | null) => void>();
  const sockets: FakeSocket[] = [];
  const refreshTokens = jest.fn<Promise<{ accessToken: string }>, []>();

  function advanceTime(ms: number): void {
    now += ms;
  }

  /** Plays the token store: stores the token, then tells the subscribers. */
  function announceToken(next: string | null): void {
    token = next;
    [...tokenListeners].forEach((listener) => listener(next));
  }

  /** A refresh as the real one behaves: the store announces the token before the call resolves. */
  function refreshSucceedsWith(accessToken: string): void {
    refreshTokens.mockImplementation(async () => {
      announceToken(accessToken);
      return { accessToken };
    });
  }

  const client = createSocketClient({
    url: SOCKET_URL,
    createSocket: (url, options) => {
      const socket = createFakeSocket(url, options);
      sockets.push(socket);
      return socket;
    },
    getAccessToken: getAccessToken ?? (async () => token),
    refreshTokens,
    subscribeToAccessToken: (listener) => {
      if (subscriptionFails) {
        subscriptionFails = false;
        throw new Error('subscription failed');
      }
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },
    now: () => now,
  });

  const statuses: SocketStatus[] = [];
  client.subscribeToStatus((status) => statuses.push(status));

  return {
    client,
    refreshTokens,
    advanceTime,
    announceToken,
    refreshSucceedsWith,
    statuses,
    tokenListeners,
    get socket() {
      expect(sockets).toHaveLength(1);
      return sockets[0];
    },
  };
}

async function setupConnected(options?: SetupOptions) {
  const context = setup(options);
  await context.client.connect();
  context.socket.open();
  return context;
}

describe('createSocketClient', () => {
  describe('connect', () => {
    it('creates one socket for the configured URL without connecting it', () => {
      const { socket, tokenListeners } = setup();

      expect(socket.url).toBe(SOCKET_URL);
      expect(socket.connectAttempts).toEqual([]);
      expect(tokenListeners.size).toBe(0);
    });

    it('sends the stored access token as the connect param', async () => {
      const { client, socket } = setup();

      await client.connect();

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }]);
    });

    it('does not open a socket without a stored token', async () => {
      const { client, socket } = setup({ storedToken: null });

      await client.connect();

      expect(socket.connectAttempts).toEqual([]);
      expect(client.getStatus()).toBe('disconnected');
    });

    it('opens the socket once a token is announced after a start without a session', async () => {
      const { client, socket, announceToken } = setup({ storedToken: null });
      await client.connect();

      announceToken('access-1');

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }]);
      socket.open();
      expect(client.getStatus()).toBe('connected');
    });

    it('resolves and can be called again when the token subscription throws', async () => {
      const { client, socket } = setup({ failFirstSubscription: true });

      await expect(client.connect()).resolves.toBeUndefined();
      expect(socket.connectAttempts).toEqual([]);

      await client.connect();
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }]);
    });

    it('resolves when opening the socket throws and opens with the next token', async () => {
      const { client, socket, announceToken } = setup();
      socket.failNextConnect(new Error('socket could not be created'));

      await expect(client.connect()).resolves.toBeUndefined();
      expect(socket.connectAttempts).toEqual([]);
      expect(client.getStatus()).toBe('disconnected');

      announceToken('access-2');
      expect(socket.connectAttempts).toEqual([{ token: 'access-2' }]);
    });

    it('opens one connection when connect() is called twice', async () => {
      const { client, socket } = setup();

      await Promise.all([client.connect(), client.connect()]);

      expect(socket.connectAttempts).toHaveLength(1);
    });

    it('does not connect when disconnect() lands while the token is being read', async () => {
      const { client, socket } = setup();

      const connecting = client.connect();
      client.disconnect();
      await connecting;

      expect(socket.connectAttempts).toEqual([]);
    });

    it('keeps a token announced while the stored one is being read', async () => {
      const read = deferred<string | null>();
      const { client, socket, announceToken } = setup({ getAccessToken: () => read.promise });

      const connecting = client.connect();
      announceToken('access-2');
      read.resolve('access-1');
      await connecting;
      socket.open();
      socket.drop();
      socket.backoffRetry();

      expect(socket.connectAttempts).toEqual([{ token: 'access-2' }, { token: 'access-2' }]);
    });

    it('uses the read of the current run when the read of an earlier run resolves late', async () => {
      const reads = [deferred<string | null>(), deferred<string | null>()];
      let readCount = 0;
      const { client, socket } = setup({ getAccessToken: () => reads[readCount++].promise });

      const firstRun = client.connect();
      client.disconnect();
      const secondRun = client.connect();
      reads[0].resolve('access-old');
      await firstRun;
      expect(socket.connectAttempts).toEqual([]);

      reads[1].resolve('access-new');
      await secondRun;

      expect(socket.connectAttempts).toEqual([{ token: 'access-new' }]);
    });

    it('does not open a socket when the stored token cannot be read', async () => {
      const { client, socket } = setup({
        getAccessToken: () => Promise.reject(new Error('keychain unavailable')),
      });

      await expect(client.connect()).resolves.toBeUndefined();

      expect(socket.connectAttempts).toEqual([]);
    });

    it('sends the current token again when Phoenix retries on its own', async () => {
      const { socket } = await setupConnected();

      socket.drop();
      socket.backoffRetry();

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-1' }]);
    });

    it('reports connected while the socket is open and disconnected once it drops', async () => {
      const { client, socket, statuses } = setup();
      expect(client.getStatus()).toBe('disconnected');

      await client.connect();
      expect(client.getStatus()).toBe('disconnected');

      socket.open();
      expect(client.getStatus()).toBe('connected');

      socket.drop();
      expect(client.getStatus()).toBe('disconnected');
      expect(statuses).toEqual(['connected', 'disconnected']);
    });

    it('stops notifying a status listener after it unsubscribes', async () => {
      const { client, socket } = setup();
      const listener = jest.fn();
      const unsubscribe = client.subscribeToStatus(listener);

      unsubscribe();
      await client.connect();
      socket.open();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('closes the socket and stops following token changes', async () => {
      const { client, socket, announceToken } = await setupConnected();

      client.disconnect();
      announceToken('access-2');

      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toHaveLength(1);
      expect(client.getStatus()).toBe('disconnected');
    });

    it('stops waiting for a session on disconnect()', async () => {
      const { client, socket, announceToken, tokenListeners } = setup({ storedToken: null });
      await client.connect();
      expect(tokenListeners.size).toBe(1);

      client.disconnect();
      announceToken('access-1');

      expect(tokenListeners.size).toBe(0);
      expect(socket.connectAttempts).toEqual([]);
    });

    it('connects again with the stored token after a disconnect', async () => {
      const { client, socket, announceToken } = await setupConnected();

      client.disconnect();
      announceToken('access-2');
      await client.connect();

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
    });

    it('reports disconnected without waiting for a slow teardown', async () => {
      const { client, socket } = await setupConnected();
      socket.deferDisconnects();

      client.disconnect();

      expect(client.getStatus()).toBe('disconnected');
    });

    it('waits for the teardown to finish before connecting again', async () => {
      const { client, socket } = await setupConnected();
      socket.deferDisconnects();

      client.disconnect();
      await client.connect();
      expect(socket.connectAttempts).toHaveLength(1);
      socket.finishDisconnects();

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-1' }]);
    });
  });

  describe('rejected connect', () => {
    it('refreshes the tokens once and reconnects with the new token', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } = setup();
      refreshSucceedsWith('access-2');
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);

      socket.open();
      expect(client.getStatus()).toBe('connected');
    });

    it('reconnects when the refresh returns a token the store did not announce', async () => {
      const { client, socket, refreshTokens } = setup();
      refreshTokens.mockResolvedValue({ accessToken: 'access-2' });
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
    });

    it('does not start a second refresh while one is still pending', async () => {
      const { client, socket, refreshTokens } = setup();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValue(refresh.promise);
      await client.connect();

      socket.failBeforeOpen();
      socket.backoffRetry();
      socket.failBeforeOpen();
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);

      refresh.resolve({ accessToken: 'access-2' });
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('does not refresh again in a streak once a refresh succeeded', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } = setup();
      refreshSucceedsWith('access-2');
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();

      socket.failBeforeOpen();
      await flushPromises();
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(socket.connectAttempts).toEqual([
        { token: 'access-1' },
        { token: 'access-2' },
        { token: 'access-2' },
      ]);
    });

    it('refreshes again in the same streak ten minutes after a refresh that succeeded', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith, advanceTime } = setup();
      refreshSucceedsWith('access-2');
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      socket.failBeforeOpen();
      await flushPromises();

      advanceTime(10 * 60_000 - 1);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      refreshSucceedsWith('access-3');
      advanceTime(1);
      await failNextAttempt(socket);

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-3' });
    });

    it('starts the cool-down over after a refresh that succeeded', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith, advanceTime } = setup();
      const networkError = new ApiError('network_error', 'Network request failed');
      refreshTokens.mockRejectedValueOnce(networkError);
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      refreshSucceedsWith('access-2');
      advanceTime(5_000);
      await failNextAttempt(socket);
      socket.failBeforeOpen();
      await flushPromises();
      expect(refreshTokens).toHaveBeenCalledTimes(2);

      refreshTokens.mockRejectedValue(networkError);
      advanceTime(10 * 60_000);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(3);

      advanceTime(4_999);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(3);
      advanceTime(1);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(4);
    });

    it('does not refresh again during the cool-down of a refresh that failed on the network', async () => {
      const { client, socket, refreshTokens, advanceTime } = setup();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();

      await failNextAttempt(socket);
      advanceTime(4_999);
      await failNextAttempt(socket);

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(socket.disconnectCount).toBe(0);
    });

    it('refreshes again in the same streak on the first failed attempt after the cool-down', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith, advanceTime } = setup();
      refreshTokens.mockRejectedValueOnce(new ApiError('network_error', 'Network request failed'));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      refreshSucceedsWith('access-2');
      advanceTime(5_000);
      await failNextAttempt(socket);

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toEqual([
        { token: 'access-1' },
        { token: 'access-1' },
        { token: 'access-2' },
      ]);

      socket.open();
      expect(client.getStatus()).toBe('connected');
    });

    it('doubles the cool-down after each failed refresh, up to a minute', async () => {
      const { client, socket, refreshTokens, advanceTime } = setup();
      refreshTokens.mockRejectedValue(new ApiError('timeout', 'Request timeout'));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      let refreshes = 1;

      for (const cooldownMs of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
        advanceTime(cooldownMs - 1);
        await failNextAttempt(socket);
        expect(refreshTokens).toHaveBeenCalledTimes(refreshes);

        advanceTime(1);
        await failNextAttempt(socket);
        refreshes += 1;
        expect(refreshTokens).toHaveBeenCalledTimes(refreshes);
      }

      expect(socket.disconnectCount).toBe(0);
      expect(client.getStatus()).toBe('disconnected');
    });

    it('starts the cool-down over once the socket has opened', async () => {
      const { client, socket, refreshTokens, advanceTime } = setup();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      advanceTime(5_000);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(2);

      socket.backoffRetry();
      socket.open();
      socket.drop();
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(3);

      advanceTime(4_999);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(3);
      advanceTime(1);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(4);
    });

    it('starts the cool-down over when the client is disconnected and connected again', async () => {
      const { client, socket, refreshTokens } = setup();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();

      client.disconnect();
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
    });

    it('shares the pending refresh of a refused join with a rejected connect', async () => {
      const { client, socket, refreshTokens } = await setupConnected();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValue(refresh.promise);
      client.joinTopic(TOPIC);
      socket.channels[0].replyError(refusal('unauthenticated'));

      socket.drop();
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);

      refresh.resolve({ accessToken: 'access-2' });
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('starts a new streak after the socket has opened', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } = setup();
      refreshSucceedsWith('access-2');
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      socket.open();

      refreshSucceedsWith('access-3');
      socket.drop();
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-3' });
    });

    it('stays disconnected when disconnect() lands while the refresh is running', async () => {
      const { client, socket, refreshTokens } = setup();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValue(refresh.promise);
      await client.connect();
      socket.failBeforeOpen();

      client.disconnect();
      refresh.resolve({ accessToken: 'access-2' });
      await flushPromises();

      expect(socket.connectAttempts).toHaveLength(1);
    });

    it('does not refresh for an error on an open socket', async () => {
      const { socket, refreshTokens } = await setupConnected();

      socket.drop();
      await flushPromises();

      expect(refreshTokens).not.toHaveBeenCalled();
    });

    it('closes the socket as unauthenticated on an invalid session and opens it for the next token', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      refreshTokens.mockImplementation(async () => {
        // The real refresh clears the session before it rejects.
        announceToken(null);
        throw new ApiError('refresh_token_revoked', 'revoked', 401);
      });
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();

      expect(client.getStatus()).toBe('unauthenticated');
      expect(socket.disconnectCount).toBeGreaterThan(0);
      expect(socket.connectAttempts).toHaveLength(1);

      announceToken('access-2');
      expect(client.getStatus()).toBe('disconnected');
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
      socket.open();
      expect(client.getStatus()).toBe('connected');
    });

    it('stays unauthenticated until a token is announced', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      refreshTokens.mockRejectedValue(new ApiError('refresh_token_expired', 'expired', 401));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      expect(client.getStatus()).toBe('unauthenticated');
      expect(socket.disconnectCount).toBe(1);

      await client.connect();
      expect(client.getStatus()).toBe('unauthenticated');
      expect(socket.connectAttempts).toHaveLength(1);

      announceToken('access-2');
      expect(client.getStatus()).toBe('disconnected');
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('starts a new streak with the session that follows an invalid one', async () => {
      const { client, socket, refreshTokens, announceToken, refreshSucceedsWith } = setup();
      refreshTokens.mockRejectedValueOnce(new ApiError('refresh_token_expired', 'expired', 401));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      expect(client.getStatus()).toBe('unauthenticated');

      announceToken('access-2');
      refreshSucceedsWith('access-3');
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-3' });
    });

    it('starts a new streak when the client is disconnected and connected again', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } = setup();
      refreshSucceedsWith('access-2');
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      socket.failBeforeOpen();
      await flushPromises();
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      client.disconnect();
      await client.connect();
      refreshSucceedsWith('access-3');
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-3' });
    });

    it('leaves Phoenix retrying when the refresh fails on the network', async () => {
      const { client, socket, refreshTokens } = setup();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();

      expect(socket.disconnectCount).toBe(0);
      expect(client.getStatus()).toBe('disconnected');

      socket.backoffRetry();
      socket.open();
      expect(client.getStatus()).toBe('connected');
    });
  });

  describe('a refresh that outlives its run', () => {
    /** A rejected connect starts a refresh, then the client is disconnected while it is pending. */
    async function setupDisconnectedDuringRefresh() {
      const context = setup();
      const refresh = deferred<{ accessToken: string }>();
      context.refreshTokens.mockReturnValueOnce(refresh.promise);
      await context.client.connect();
      context.socket.failBeforeOpen();
      context.client.disconnect();
      return { ...context, refresh };
    }

    it('stays disconnected when the refresh then finds the session invalid', async () => {
      const { client, refresh } = await setupDisconnectedDuringRefresh();

      refresh.reject(new ApiError('refresh_token_revoked', 'revoked', 401));
      await flushPromises();

      expect(client.getStatus()).toBe('disconnected');
    });

    it('keeps a new run going when the refresh of the previous one finds the session invalid', async () => {
      const { client, socket, refresh, announceToken } = await setupDisconnectedDuringRefresh();
      await client.connect();

      refresh.reject(new ApiError('refresh_token_revoked', 'revoked', 401));
      await flushPromises();

      expect(client.getStatus()).toBe('disconnected');
      expect(socket.disconnectCount).toBe(1);
      socket.open();
      expect(client.getStatus()).toBe('connected');

      announceToken('access-2');
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('leaves a new run on the token the store gave it when the previous refresh resolves', async () => {
      const { client, socket, refresh, announceToken } = await setupDisconnectedDuringRefresh();
      await client.connect();

      refresh.resolve({ accessToken: 'access-from-previous-run' });
      await flushPromises();

      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-1' }]);

      // A refresh that really rotated the session reaches the new run through the store.
      announceToken('access-2');
      expect(socket.disconnectCount).toBe(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('stays disconnected when disconnect() follows the cleared session of an invalid refresh', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValueOnce(refresh.promise);
      await client.connect();
      socket.failBeforeOpen();

      announceToken(null);
      client.disconnect();
      refresh.reject(new ApiError('refresh_token_revoked', 'revoked', 401));
      await flushPromises();

      expect(client.getStatus()).toBe('disconnected');
    });

    it('reports unauthenticated when the session is cleared twice before the refresh rejects', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValueOnce(refresh.promise);
      await client.connect();
      socket.failBeforeOpen();

      announceToken(null);
      announceToken(null);
      refresh.reject(new ApiError('refresh_token_revoked', 'revoked', 401));
      await flushPromises();

      expect(client.getStatus()).toBe('unauthenticated');
    });

    it('stays disconnected when the session is cleared and the refresh then fails on the network', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValueOnce(refresh.promise);
      await client.connect();
      socket.failBeforeOpen();

      announceToken(null);
      refresh.reject(new ApiError('network_error', 'Network request failed'));
      await flushPromises();

      expect(client.getStatus()).toBe('disconnected');
    });

    it('keeps a new run going when it started after the cleared session of an invalid refresh', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValueOnce(refresh.promise);
      await client.connect();
      socket.failBeforeOpen();

      announceToken(null);
      announceToken('access-2');
      await client.connect();
      refresh.reject(new ApiError('refresh_token_revoked', 'revoked', 401));
      await flushPromises();

      expect(client.getStatus()).toBe('disconnected');
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
      socket.open();
      expect(client.getStatus()).toBe('connected');
    });

    it('runs its own refresh instead of waiting for the one of the previous run', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } =
        await setupDisconnectedDuringRefresh();
      refreshSucceedsWith('access-2');
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('does not arm the cool-down of a new run when the previous refresh fails', async () => {
      const { client, socket, refreshTokens, refresh, refreshSucceedsWith } =
        await setupDisconnectedDuringRefresh();
      await client.connect();

      refresh.reject(new ApiError('network_error', 'Network request failed'));
      await flushPromises();
      refreshSucceedsWith('access-2');
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('does not refuse a topic whose refresh fails after the client was disconnected', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } = await setupConnected();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValueOnce(refresh.promise);
      const onRefused = jest.fn();
      client.joinTopic(TOPIC, { onRefused });
      const [channel] = socket.channels;
      channel.replyError(refusal('unauthenticated'));

      client.disconnect();
      refresh.reject(new ApiError('network_error', 'Network request failed'));
      await flushPromises();

      expect(onRefused).not.toHaveBeenCalled();
      expect(channel.hasLeft()).toBe(false);

      // The topic gets a refresh of its own in the next run.
      refreshSucceedsWith('access-2');
      await client.connect();
      socket.open();
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(onRefused).not.toHaveBeenCalled();
    });
  });

  describe('token changes', () => {
    it('reconnects once with the new token when it rotates elsewhere', async () => {
      const { client, socket, announceToken } = await setupConnected();

      announceToken('access-2');

      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
      expect(client.getStatus()).toBe('disconnected');
    });

    it('reconnects exactly once for a refresh the socket triggered', async () => {
      const { client, socket, refreshSucceedsWith } = setup();
      refreshSucceedsWith('access-2');
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();

      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toHaveLength(2);
    });

    it('ignores an announcement of the token the socket already holds', async () => {
      const { socket, announceToken } = await setupConnected();

      announceToken('access-1');

      expect(socket.disconnectCount).toBe(0);
      expect(socket.connectAttempts).toHaveLength(1);
    });

    it('ignores token changes until connect() is called', () => {
      const { socket, announceToken } = setup();

      announceToken('access-2');

      expect(socket.connectAttempts).toEqual([]);
    });

    it('disconnects when the session is cleared', async () => {
      const { client, socket, announceToken } = await setupConnected();

      announceToken(null);

      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toHaveLength(1);
      expect(client.getStatus()).toBe('disconnected');
    });

    it('opens again and rejoins a joined topic when a token follows a cleared session', async () => {
      const { client, socket, announceToken } = await setupConnected();
      const onJoined = jest.fn();
      client.joinTopic(TOPIC, { onJoined });
      const [channel] = socket.channels;
      channel.replyOk();
      announceToken(null);

      announceToken('access-2');

      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
      socket.open();
      channel.replyOk();
      expect(client.getStatus()).toBe('connected');
      expect(socket.channels).toHaveLength(1);
      expect(channel.hasLeft()).toBe(false);
      expect(onJoined).toHaveBeenCalledTimes(2);
    });

    it('connects once with the latest token when it rotates twice during a teardown', async () => {
      const { socket, announceToken } = await setupConnected();
      socket.deferDisconnects();

      announceToken('access-2');
      announceToken('access-3');
      expect(socket.connectAttempts).toHaveLength(1);
      socket.finishDisconnects();

      expect(socket.disconnectCount).toBe(1);
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-3' }]);
    });

    it('does not refresh for the error of an attempt it aborted to send a new token', async () => {
      const { client, socket, announceToken, refreshTokens } = setup();
      await client.connect();

      announceToken('access-2');
      await flushPromises();

      expect(refreshTokens).not.toHaveBeenCalled();
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
    });

    it('does not reconnect when disconnect() lands during a teardown', async () => {
      const { client, socket, announceToken } = await setupConnected();
      socket.deferDisconnects();

      announceToken('access-2');
      client.disconnect();
      socket.finishDisconnects();

      expect(socket.connectAttempts).toHaveLength(1);
    });
  });

  describe('joinTopic', () => {
    async function setupJoined() {
      const context = await setupConnected();
      const onJoined = jest.fn();
      const onRefused = jest.fn();
      const subscription = context.client.joinTopic(TOPIC, { onJoined, onRefused });
      const [channel] = context.socket.channels;
      return { ...context, onJoined, onRefused, subscription, channel };
    }

    it('joins the topic and calls onJoined on an ok reply', async () => {
      const { socket, channel, onJoined, onRefused } = await setupJoined();

      expect(socket.channels).toHaveLength(1);
      expect(channel.topic).toBe(TOPIC);
      expect(onJoined).not.toHaveBeenCalled();

      channel.replyOk();

      expect(onJoined).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
      expect(channel.hasLeft()).toBe(false);
    });

    it('calls onJoined again when the topic rejoins after a reconnect', async () => {
      const { socket, channel, onJoined, announceToken } = await setupJoined();
      channel.replyOk();

      announceToken('access-2');
      socket.open();
      channel.replyOk();

      expect(socket.channels).toHaveLength(1);
      expect(onJoined).toHaveBeenCalledTimes(2);
    });

    describe('server events', () => {
      it('hands a pushed event to the handler given at join', async () => {
        const { socket, client } = await setupConnected();
        const onSessionResumed = jest.fn();
        client.joinTopic(TOPIC, { events: { session_resumed: onSessionResumed } });
        const [channel] = socket.channels;

        channel.replyOk();
        channel.serverPush('session_resumed', { sessionId: 's-1' });

        expect(onSessionResumed).toHaveBeenCalledWith({ sessionId: 's-1' });
      });

      it('ignores events it has no handler for', async () => {
        const { socket, client } = await setupConnected();
        const handler = jest.fn();
        client.joinTopic(TOPIC, { events: { session_expired: handler } });
        const [channel] = socket.channels;

        channel.serverPush('session_lost_lock', {});

        expect(handler).not.toHaveBeenCalled();
      });

      it('keeps delivering events after the topic rejoins on a new connection', async () => {
        const { socket, client, announceToken } = await setupConnected();
        const handler = jest.fn();
        client.joinTopic(TOPIC, { events: { session_resumed: handler } });
        const [channel] = socket.channels;
        channel.replyOk();

        announceToken('access-2');
        socket.open();
        channel.replyOk();
        channel.serverPush('session_resumed', { sessionId: 's-2' });

        expect(socket.channels).toHaveLength(1);
        expect(handler).toHaveBeenCalledWith({ sessionId: 's-2' });
      });

      it('lets the subscription add a handler and drop it again', async () => {
        const { socket, client } = await setupConnected();
        const subscription = client.joinTopic(TOPIC);
        const [channel] = socket.channels;
        const handler = jest.fn();

        const stop = subscription.on('session_expired', handler);
        channel.serverPush('session_expired', { a: 1 });
        stop();
        channel.serverPush('session_expired', { a: 2 });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ a: 1 });
      });

      it('stops delivering events once the topic is left', async () => {
        const { socket, client } = await setupConnected();
        const handler = jest.fn();
        const subscription = client.joinTopic(TOPIC, { events: { session_expired: handler } });
        const [channel] = socket.channels;

        subscription.leave();
        channel.serverPush('session_expired', {});

        expect(handler).not.toHaveBeenCalled();
      });
    });

    it.each(['forbidden', 'trial_expired'] as const)(
      'hands a %s refusal to onRefused and leaves the channel',
      async (code) => {
        const { channel, onJoined, onRefused, refreshTokens } = await setupJoined();

        channel.replyError(refusal(code, 'Join refused.'));

        expect(onRefused).toHaveBeenCalledTimes(1);
        const error = onRefused.mock.calls[0][0];
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ code, message: 'Join refused.' });
        expect(channel.hasLeft()).toBe(true);
        expect(onJoined).not.toHaveBeenCalled();
        expect(refreshTokens).not.toHaveBeenCalled();
      }
    );

    it('refreshes, reconnects and joins after an unauthenticated refusal', async () => {
      const { socket, channel, onJoined, onRefused, refreshTokens, refreshSucceedsWith } =
        await setupJoined();
      refreshSucceedsWith('access-2');

      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
      expect(channel.hasLeft()).toBe(false);
      expect(onRefused).not.toHaveBeenCalled();

      socket.open();
      channel.replyOk();

      expect(onJoined).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
    });

    it('hands a second unauthenticated refusal to onRefused after the reconnect', async () => {
      const { socket, channel, onRefused, refreshTokens, refreshSucceedsWith } =
        await setupJoined();
      refreshSucceedsWith('access-2');
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();
      socket.open();

      channel.replyError(refusal('unauthenticated', 'Still expired.'));
      await flushPromises();

      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(onRefused.mock.calls[0][0]).toMatchObject({
        code: 'unauthenticated',
        message: 'Still expired.',
      });
      expect(channel.hasLeft()).toBe(true);
      expect(refreshTokens).toHaveBeenCalledTimes(1);
    });

    it('ignores a rejoin refused on the stale connection while the refresh is running', async () => {
      const { socket, channel, onRefused, refreshTokens, announceToken } = await setupJoined();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValue(refresh.promise);

      channel.replyError(refusal('unauthenticated'));
      channel.replyError(refusal('unauthenticated'));
      announceToken('access-2');
      refresh.resolve({ accessToken: 'access-2' });
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
      expect(channel.hasLeft()).toBe(false);
      expect(socket.connectAttempts).toHaveLength(2);
    });

    it('refreshes again for a topic that joined after its first refresh', async () => {
      const { socket, channel, onRefused, refreshTokens, refreshSucceedsWith } =
        await setupJoined();
      refreshSucceedsWith('access-2');
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();
      socket.open();
      channel.replyOk();

      refreshSucceedsWith('access-3');
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(onRefused).not.toHaveBeenCalled();
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-3' });
    });

    it('keeps the topic when the refresh fails on the network', async () => {
      const { client, channel, onRefused, refreshTokens } = await setupJoined();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));

      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(onRefused).not.toHaveBeenCalled();
      expect(channel.hasLeft()).toBe(false);
      expect(client.getStatus()).toBe('connected');
    });

    it('does not refresh again for a refusal inside the cool-down of a failed refresh', async () => {
      const { channel, onRefused, refreshTokens, advanceTime } = await setupJoined();
      refreshTokens.mockRejectedValue(new ApiError('timeout', 'Request timeout'));
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      channel.replyError(refusal('unauthenticated'));
      advanceTime(4_999);
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
      expect(channel.hasLeft()).toBe(false);
    });

    it('refreshes again for a refusal after the cool-down and joins once the socket reopens', async () => {
      const {
        socket,
        channel,
        onJoined,
        onRefused,
        refreshTokens,
        refreshSucceedsWith,
        advanceTime,
      } = await setupJoined();
      refreshTokens.mockRejectedValueOnce(new ApiError('network_error', 'Network request failed'));
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      refreshSucceedsWith('access-2');
      advanceTime(5_000);
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(2);
      expect(socket.connectAttempts).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);

      socket.open();
      channel.replyOk();

      expect(onJoined).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
    });

    it('shares the cool-down of a failed refresh with rejected connects', async () => {
      const { socket, channel, refreshTokens, advanceTime } = await setupJoined();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));
      channel.replyError(refusal('unauthenticated'));
      await flushPromises();
      socket.drop();

      advanceTime(4_999);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      // The rejected connect spends the second step of the same budget: ten seconds.
      advanceTime(1);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(2);
      advanceTime(9_999);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(2);
      advanceTime(1);
      await failNextAttempt(socket);
      expect(refreshTokens).toHaveBeenCalledTimes(3);
    });

    it('ignores a refusal on a connection that reopened on its own during the refresh', async () => {
      const { socket, channel, onJoined, onRefused, refreshTokens, announceToken } =
        await setupJoined();
      const refresh = deferred<{ accessToken: string }>();
      refreshTokens.mockReturnValue(refresh.promise);
      channel.replyError(refusal('unauthenticated'));

      socket.drop();
      socket.backoffRetry();
      socket.open();
      channel.replyError(refusal('unauthenticated'));
      expect(onRefused).not.toHaveBeenCalled();

      announceToken('access-2');
      refresh.resolve({ accessToken: 'access-2' });
      await flushPromises();
      socket.open();
      channel.replyOk();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(onJoined).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
    });

    it('stops the socket when the refresh for a join finds the session invalid', async () => {
      const { client, channel, onRefused, refreshTokens } = await setupJoined();
      refreshTokens.mockRejectedValue(new ApiError('refresh_token_revoked', 'revoked', 401));

      channel.replyError(refusal('unauthenticated'));
      await flushPromises();

      expect(client.getStatus()).toBe('unauthenticated');
      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(channel.hasLeft()).toBe(true);
    });

    it.each([
      ['a free-text reason', 'unauthorized'],
      ['an empty payload', {}],
      ['no payload', undefined],
      ['an unknown code', refusal('not_a_real_code')],
    ])('hands %s to onRefused as an unknown error', async (_label, payload) => {
      const { channel, onRefused } = await setupJoined();

      channel.replyError(payload);

      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(onRefused.mock.calls[0][0]).toMatchObject({
        code: 'unknown_error',
        message: 'Request failed',
      });
      expect(channel.hasLeft()).toBe(true);
    });

    it('leaves the channel on leave()', async () => {
      const { channel, subscription } = await setupJoined();
      channel.replyOk();

      subscription.leave();

      expect(channel.hasLeft()).toBe(true);
    });

    it('does not report a refusal once the topic was left during the refresh', async () => {
      const { channel, subscription, onRefused, refreshTokens } = await setupJoined();
      refreshTokens.mockRejectedValue(new ApiError('refresh_token_revoked', 'revoked', 401));

      channel.replyError(refusal('unauthenticated'));
      subscription.leave();
      await flushPromises();

      expect(onRefused).not.toHaveBeenCalled();
    });

    it('joins without handlers', async () => {
      const { client, socket } = await setupConnected();

      client.joinTopic(TOPIC);
      const [channel] = socket.channels;

      expect(() => {
        channel.replyOk();
        channel.replyError(refusal('forbidden'));
      }).not.toThrow();
      expect(channel.hasLeft()).toBe(true);
    });
  });
});

describe('planningTopic', () => {
  it('builds the planning topic of an account', () => {
    expect(planningTopic('account-1')).toBe('planning:account-1');
  });
});
