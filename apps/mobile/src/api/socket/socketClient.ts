import { errorFromEnvelope, isSessionInvalidAuthError, type ApiError } from '../errors';

/**
 * The part of the Phoenix client this module calls. Depending on these shapes
 * instead of the `phoenix` classes lets a test inject a fake socket.
 */
export interface PhoenixPush {
  receive(status: 'ok' | 'error', callback: (response: unknown) => void): PhoenixPush;
}

export interface PhoenixChannel {
  join(): PhoenixPush;
  leave(): unknown;
}

export interface PhoenixSocket {
  connect(): void;
  disconnect(callback?: () => void): void;
  onOpen(callback: () => void): unknown;
  onClose(callback: () => void): unknown;
  onError(callback: () => void): unknown;
  channel(topic: string): PhoenixChannel;
}

export interface PhoenixSocketOptions {
  /** Phoenix calls it on every connection attempt, its own reconnects included. */
  params: () => { token?: string };
}

export interface SocketClientDeps {
  url: string;
  createSocket: (url: string, options: PhoenixSocketOptions) => PhoenixSocket;
  getAccessToken: () => Promise<string | null>;
  refreshTokens: () => Promise<{ accessToken: string }>;
  subscribeToAccessToken: (listener: (accessToken: string | null) => void) => () => void;
}

/**
 * `unauthenticated` means the session could not be refreshed: the socket has
 * stopped and stays stopped until `connect()` finds a new session.
 */
export type SocketStatus = 'connected' | 'disconnected' | 'unauthenticated';

export interface TopicJoinHandlers {
  /** The server accepted the join. Called again when the topic rejoins after a reconnect. */
  onJoined?: () => void;
  /** The server refused the join. The topic has been left and is not retried. */
  onRefused?: (error: ApiError) => void;
}

export interface TopicSubscription {
  leave(): void;
}

export interface SocketClient {
  /** Opens the socket with the stored access token. Does nothing without a stored session. */
  connect(): Promise<void>;
  disconnect(): void;
  /**
   * Joins `topic` and keeps it joined across reconnects until `leave()`. Hold
   * one subscription per topic: Phoenix leaves the older channel when the same
   * topic is joined twice.
   */
  joinTopic(topic: string, handlers?: TopicJoinHandlers): TopicSubscription;
  getStatus(): SocketStatus;
  subscribeToStatus(listener: (status: SocketStatus) => void): () => void;
}

export function createSocketClient(deps: SocketClientDeps): SocketClient {
  let status: SocketStatus = 'disconnected';
  const statusListeners = new Set<(status: SocketStatus) => void>();

  // True from connect() until disconnect(), a cleared session or an invalid one.
  let started = false;
  // The token the next connection attempt sends. Not null only while started.
  let token: string | null = null;
  let unsubscribeFromTokens: (() => void) | null = null;

  let isOpen = false;
  // Number of connections opened so far. A join compares it to tell a new
  // connection from the one that refused it.
  let openCount = 0;
  let closing = false;
  // A streak is the run of failed connection attempts since the client started
  // or the socket last opened. True while a refresh for the current streak is
  // pending or has succeeded.
  let refreshSpentThisStreak = false;
  let refreshInFlight: Promise<boolean> | null = null;

  const socket = deps.createSocket(deps.url, {
    params: () => (token === null ? {} : { token }),
  });

  socket.onOpen(() => {
    isOpen = true;
    openCount += 1;
    refreshSpentThisStreak = false;
    setStatus('connected');
  });

  socket.onClose(markClosed);

  socket.onError(() => {
    // The server refuses the WebSocket upgrade of an invalid token without a
    // readable reason, so an error before the socket opened is treated as a
    // possible rejection and answered with a refresh. Phoenix keeps retrying
    // on its backoff and every failed attempt reports an error, so a streak
    // spends its refresh once one succeeded: a server that still refuses the
    // new token is not refusing it for the token. A refresh that found the
    // session invalid stops the socket. One that failed for any other reason,
    // such as no network, settles nothing and the next failed attempt tries
    // again. The error of a connection this client is closing is ignored.
    if (isOpen || closing || refreshSpentThisStreak) return;
    refreshSpentThisStreak = true;
    void refreshSession().then((refreshed) => {
      if (!refreshed) refreshSpentThisStreak = false;
    });
  });

  function setStatus(next: SocketStatus): void {
    if (next === status) return;
    status = next;
    statusListeners.forEach((listener) => listener(next));
  }

  function markClosed(): void {
    isOpen = false;
    if (status === 'connected') setStatus('disconnected');
  }

  function openTransport(): void {
    // A teardown in progress connects when it finishes.
    if (!closing) socket.connect();
  }

  /**
   * Closes the connection and, when the client still holds a token once
   * Phoenix has finished the teardown, opens a new one. Connecting before the
   * teardown ends would make Phoenix handle the old connection's close event
   * against the new connection.
   */
  function closeTransport(): void {
    markClosed();
    if (closing) return;
    closing = true;
    socket.disconnect(() => {
      closing = false;
      if (token !== null) socket.connect();
    });
  }

  function adoptToken(next: string): void {
    token = next;
    if (status === 'unauthenticated') setStatus('disconnected');
  }

  function halt(): void {
    if (!started) return;
    started = false;
    token = null;
    refreshSpentThisStreak = false;
    unsubscribeFromTokens?.();
    unsubscribeFromTokens = null;
    closeTransport();
  }

  function handleTokenChange(next: string | null): void {
    if (!started) return;
    if (next === null) {
      halt();
      return;
    }
    if (next === token) return;
    // The server keeps the token the socket connected with, so a new token
    // needs a new connection. Phoenix rejoins the joined topics once it opens.
    adoptToken(next);
    closeTransport();
  }

  /**
   * Refreshes the session for the socket and resolves true when it succeeded;
   * a started socket then holds the new token. A rejected connect and a
   * refused join that ask while a refresh is running share it.
   */
  function refreshSession(): Promise<boolean> {
    refreshInFlight ??= runRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function runRefresh(): Promise<boolean> {
    try {
      const tokens = await deps.refreshTokens();
      // Usually a no-op: the token store announces the token before the
      // refresh resolves, and that announcement already restarted the socket.
      handleTokenChange(tokens.accessToken);
      return true;
    } catch (error) {
      if (isSessionInvalidAuthError(error)) {
        halt();
        setStatus('unauthenticated');
      }
      // Any other failure leaves the socket as it is: Phoenix keeps retrying.
      return false;
    }
  }

  async function connect(): Promise<void> {
    if (started) return;
    started = true;
    unsubscribeFromTokens = deps.subscribeToAccessToken(handleTokenChange);

    const stored = await deps.getAccessToken().catch(() => null);
    // Nothing left to do when disconnect() or a cleared session cancelled the
    // start, or when the store announced a token during the read.
    if (!started || token !== null) return;
    if (stored === null) {
      halt();
      return;
    }
    adoptToken(stored);
    openTransport();
  }

  function joinTopic(topic: string, handlers: TopicJoinHandlers = {}): TopicSubscription {
    const channel = socket.channel(topic);
    let left = false;
    // The connection whose `unauthenticated` refusal was answered with a
    // refresh; null while the topic has not spent its refresh.
    let refreshedOnOpenCount: number | null = null;

    function leave(): void {
      if (left) return;
      left = true;
      channel.leave();
    }

    function refuse(error: ApiError): void {
      if (left) return;
      // Phoenix rejoins a refused channel on a timer until it is left.
      leave();
      handlers.onRefused?.(error);
    }

    channel
      .join()
      .receive('ok', () => {
        refreshedOnOpenCount = null;
        handlers.onJoined?.();
      })
      .receive('error', (payload) => {
        // A channel reply has no HTTP status.
        const error = errorFromEnvelope(payload, 0);
        if (error.code !== 'unauthenticated') {
          refuse(error);
          return;
        }
        if (refreshedOnOpenCount === null) {
          // The socket outlived its access token. Phoenix rejoins the topic
          // once the socket reopens with the refreshed one.
          refreshedOnOpenCount = openCount;
          void refreshSession().then((refreshed) => {
            if (!refreshed) refuse(error);
          });
          return;
        }
        // Phoenix's rejoin timer can fire on the stale connection before the
        // refresh ends; only a refusal on a newer connection is final.
        if (refreshedOnOpenCount !== openCount) refuse(error);
      });

    return { leave };
  }

  return {
    connect,
    disconnect: halt,
    joinTopic,
    getStatus: () => status,
    subscribeToStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
}
