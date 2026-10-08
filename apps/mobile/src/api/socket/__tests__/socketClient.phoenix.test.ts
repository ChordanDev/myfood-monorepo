import { Socket } from 'phoenix';

import { ApiError } from '../../errors';
import { createSocketClient } from '../socketClient';

/**
 * Runs the socket client on the real Phoenix client over a scripted WebSocket.
 * The other suites use a fake socket; this one pins the Phoenix behaviour that
 * fake stands for: the error of a refused upgrade, the rejoin after a reopen
 * and the rejoin timer that only `leave()` stops.
 */
const TOPIC = 'planning:account-1';
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
const UNAUTHENTICATED = { error: { code: 'unauthenticated', message: 'Token expired.' } };

type Frame = [
  joinRef: string | null,
  ref: string | null,
  topic: string,
  event: string,
  payload: unknown,
];

class ScriptedWebSocket {
  static instances: ScriptedWebSocket[] = [];

  readyState = CONNECTING;
  onopen: () => void = () => {};
  onerror: (error: unknown) => void = () => {};
  onmessage: (event: { data: string }) => void = () => {};
  onclose: (event: { code: number }) => void = () => {};
  readonly sent: Frame[] = [];

  constructor(readonly url: string) {
    ScriptedWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onclose({ code: 1000 });
  }

  acceptUpgrade(): void {
    this.readyState = OPEN;
    this.onopen();
  }

  /** What React Native reports for a refused upgrade: closed, an error, then a close. */
  refuseUpgrade(): void {
    this.readyState = CLOSED;
    this.onerror(new Error('upgrade refused'));
    this.onclose({ code: 1006 });
  }

  joins(): Frame[] {
    return this.sent.filter(([, , topic, event]) => topic === TOPIC && event === 'phx_join');
  }

  replyToLastJoin(status: 'ok' | 'error', response: unknown): void {
    const [joinRef, ref, topic] = this.joins().at(-1) as Frame;
    this.onmessage({
      data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response }]),
    });
  }
}

function setup() {
  let token = 'access-1';
  const tokenListeners = new Set<(accessToken: string | null) => void>();

  /** Plays the token store after a refresh: stores the new token, then tells the subscribers. */
  function rotateToken(): { accessToken: string } {
    token = 'access-2';
    [...tokenListeners].forEach((listener) => listener(token));
    return { accessToken: token };
  }

  /** Plays the token store when the session is cleared. */
  function clearToken(): void {
    [...tokenListeners].forEach((listener) => listener(null));
  }

  const refreshTokens = jest.fn<Promise<{ accessToken: string }>, []>(async () => rotateToken());

  const client = createSocketClient({
    url: 'wss://api.example.test/socket',
    createSocket: (url, options) => new Socket(url, { ...options, transport: ScriptedWebSocket }),
    getAccessToken: async () => token,
    refreshTokens,
    subscribeToAccessToken: (listener) => {
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },
  });

  return { client, refreshTokens, rotateToken, clearToken };
}

async function setupJoining() {
  const context = setup();
  const onJoined = jest.fn();
  const onRefused = jest.fn();
  await context.client.connect();
  lastConnection().acceptUpgrade();
  context.client.joinTopic(TOPIC, { onJoined, onRefused });
  return { ...context, onJoined, onRefused };
}

function connections(): ScriptedWebSocket[] {
  return ScriptedWebSocket.instances;
}

function lastConnection(): ScriptedWebSocket {
  return connections().at(-1) as ScriptedWebSocket;
}

function tokenOf(connection: ScriptedWebSocket): string | null {
  return new URL(connection.url).searchParams.get('token');
}

describe('createSocketClient on the Phoenix client', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ScriptedWebSocket.instances = [];
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('connects to the websocket transport with the token as a param', async () => {
    const { client } = setup();

    await client.connect();

    expect(connections()).toHaveLength(1);
    const url = new URL(lastConnection().url);
    expect(`${url.origin}${url.pathname}`).toBe('wss://api.example.test/socket/websocket');
    expect(url.searchParams.get('token')).toBe('access-1');
  });

  it('refreshes after a refused upgrade and reconnects with the new token', async () => {
    const { client, refreshTokens } = setup();
    await client.connect();

    lastConnection().refuseUpgrade();
    await jest.advanceTimersByTimeAsync(0);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(connections().map(tokenOf)).toEqual(['access-1', 'access-2']);

    lastConnection().acceptUpgrade();
    expect(client.getStatus()).toBe('connected');
  });

  it('rejoins a joined topic on the connection opened for a rotated token', async () => {
    const { rotateToken, onJoined } = await setupJoining();
    lastConnection().replyToLastJoin('ok', {});

    rotateToken();
    lastConnection().acceptUpgrade();
    lastConnection().replyToLastJoin('ok', {});

    expect(connections().map(tokenOf)).toEqual(['access-1', 'access-2']);
    expect(lastConnection().joins()).toHaveLength(1);
    expect(onJoined).toHaveBeenCalledTimes(2);
  });

  it('stops Phoenix from rejoining a refused topic', async () => {
    const { onRefused } = await setupJoining();

    lastConnection().replyToLastJoin('error', {
      error: { code: 'forbidden', message: 'Not a member.' },
    });
    await jest.advanceTimersByTimeAsync(30_000);

    expect(onRefused).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
    expect(lastConnection().joins()).toHaveLength(1);
  });

  it('joins on the refreshed connection after an unauthenticated refusal', async () => {
    const { refreshTokens, onJoined, onRefused } = await setupJoining();

    lastConnection().replyToLastJoin('error', UNAUTHENTICATED);
    await jest.advanceTimersByTimeAsync(0);
    lastConnection().acceptUpgrade();
    lastConnection().replyToLastJoin('ok', {});

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(connections().map(tokenOf)).toEqual(['access-1', 'access-2']);
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('survives the rejoin Phoenix sends on the stale connection during a slow refresh', async () => {
    const { refreshTokens, rotateToken, onJoined, onRefused } = await setupJoining();
    let finishRefresh = () => {};
    refreshTokens.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = () => resolve(rotateToken());
        })
    );
    const staleConnection = lastConnection();

    staleConnection.replyToLastJoin('error', UNAUTHENTICATED);
    // Phoenix's first rejoin delay is one second.
    await jest.advanceTimersByTimeAsync(1_000);
    expect(staleConnection.joins()).toHaveLength(2);
    staleConnection.replyToLastJoin('error', UNAUTHENTICATED);
    expect(onRefused).not.toHaveBeenCalled();

    finishRefresh();
    await jest.advanceTimersByTimeAsync(0);
    lastConnection().acceptUpgrade();
    lastConnection().replyToLastJoin('ok', {});

    expect(lastConnection()).not.toBe(staleConnection);
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('rejoins a joined topic when a session returns after it was cleared', async () => {
    const { clearToken, rotateToken, onJoined } = await setupJoining();
    lastConnection().replyToLastJoin('ok', {});

    clearToken();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(connections()).toHaveLength(1);

    rotateToken();
    lastConnection().acceptUpgrade();
    lastConnection().replyToLastJoin('ok', {});

    expect(connections().map(tokenOf)).toEqual(['access-1', 'access-2']);
    expect(lastConnection().joins()).toHaveLength(1);
    expect(onJoined).toHaveBeenCalledTimes(2);
  });

  it('keeps a topic on the rejoin timer while the refresh fails, then joins with the refreshed token', async () => {
    const { refreshTokens, onJoined, onRefused } = await setupJoining();
    refreshTokens.mockRejectedValueOnce(new ApiError('network_error', 'Network request failed'));
    const staleConnection = lastConnection();
    staleConnection.replyToLastJoin('error', UNAUTHENTICATED);

    // Phoenix rejoins after 1 s and 2 s, inside the 5 s cool-down of the failed refresh.
    await jest.advanceTimersByTimeAsync(1_000);
    staleConnection.replyToLastJoin('error', UNAUTHENTICATED);
    await jest.advanceTimersByTimeAsync(2_000);
    staleConnection.replyToLastJoin('error', UNAUTHENTICATED);
    expect(staleConnection.joins()).toHaveLength(3);
    expect(refreshTokens).toHaveBeenCalledTimes(1);

    // The next rejoin, 5 s later, is past the cool-down.
    await jest.advanceTimersByTimeAsync(5_000);
    staleConnection.replyToLastJoin('error', UNAUTHENTICATED);
    await jest.advanceTimersByTimeAsync(0);
    expect(refreshTokens).toHaveBeenCalledTimes(2);

    lastConnection().acceptUpgrade();
    lastConnection().replyToLastJoin('ok', {});

    expect(connections().map(tokenOf)).toEqual(['access-1', 'access-2']);
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
  });
});
