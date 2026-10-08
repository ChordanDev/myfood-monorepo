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
}

function setup({ storedToken = 'access-1', getAccessToken }: SetupOptions = {}) {
  let token = storedToken;
  const tokenListeners = new Set<(accessToken: string | null) => void>();
  const sockets: FakeSocket[] = [];
  const refreshTokens = jest.fn<Promise<{ accessToken: string }>, []>();

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
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },
  });

  const statuses: SocketStatus[] = [];
  client.subscribeToStatus((status) => statuses.push(status));

  return {
    client,
    refreshTokens,
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
      const { client, socket, tokenListeners } = setup({ storedToken: null });

      await client.connect();

      expect(socket.connectAttempts).toEqual([]);
      expect(client.getStatus()).toBe('disconnected');
      expect(tokenListeners.size).toBe(0);
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

    it('refreshes again in the same streak after the refresh failed on the network', async () => {
      const { client, socket, refreshTokens, refreshSucceedsWith } = setup();
      refreshTokens.mockRejectedValueOnce(new ApiError('network_error', 'Network request failed'));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      refreshSucceedsWith('access-2');
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();

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

    it('keeps retrying the refresh on each failed attempt while it fails on the network', async () => {
      const { client, socket, refreshTokens } = setup();
      refreshTokens.mockRejectedValue(new ApiError('timeout', 'Request timeout'));
      await client.connect();

      socket.failBeforeOpen();
      await flushPromises();
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();
      socket.backoffRetry();
      socket.failBeforeOpen();
      await flushPromises();

      expect(refreshTokens).toHaveBeenCalledTimes(3);
      expect(socket.disconnectCount).toBe(0);
      expect(client.getStatus()).toBe('disconnected');
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

    it('stops and reports unauthenticated when the refresh finds the session invalid', async () => {
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
      expect(socket.connectAttempts).toHaveLength(1);
    });

    it('leaves the unauthenticated state when connect() finds a new session', async () => {
      const { client, socket, refreshTokens, announceToken } = setup();
      refreshTokens.mockRejectedValue(new ApiError('refresh_token_expired', 'expired', 401));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      expect(client.getStatus()).toBe('unauthenticated');
      expect(socket.disconnectCount).toBe(1);

      announceToken('access-2');
      expect(socket.connectAttempts).toHaveLength(1);
      await client.connect();

      expect(client.getStatus()).toBe('disconnected');
      expect(socket.connectAttempts.at(-1)).toEqual({ token: 'access-2' });
    });

    it('starts a new streak when it connects again after an invalid session', async () => {
      const { client, socket, refreshTokens, announceToken, refreshSucceedsWith } = setup();
      refreshTokens.mockRejectedValueOnce(new ApiError('refresh_token_expired', 'expired', 401));
      await client.connect();
      socket.failBeforeOpen();
      await flushPromises();
      expect(client.getStatus()).toBe('unauthenticated');

      announceToken('access-2');
      await client.connect();
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

    it('hands the refusal to onRefused when the refresh fails', async () => {
      const { client, channel, onRefused, refreshTokens } = await setupJoined();
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));

      channel.replyError(refusal('unauthenticated', 'Token expired.'));
      await flushPromises();

      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(onRefused.mock.calls[0][0]).toMatchObject({
        code: 'unauthenticated',
        message: 'Token expired.',
      });
      expect(channel.hasLeft()).toBe(true);
      expect(client.getStatus()).toBe('connected');
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
      refreshTokens.mockRejectedValue(new ApiError('network_error', 'Network request failed'));

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
