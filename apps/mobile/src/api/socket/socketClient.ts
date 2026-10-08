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
  /** The clock of the refresh cool-down, in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
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

/**
 * Wait before a failure streak may refresh again after a refresh that failed
 * for a transient reason. It starts at Phoenix's longest reconnect delay and
 * doubles per failure: 5 s, 10 s, 20 s, 40 s, then 60 s. Every refresh is a
 * rotation request for the refresh token, and one whose response is lost can
 * leave the stored token stale, so an outage must not send one per reconnect
 * attempt.
 */
const REFRESH_COOLDOWN_BASE_MS = 5_000;
const REFRESH_COOLDOWN_MAX_MS = 60_000;

function refreshCooldownMs(failedRefreshes: number): number {
  return Math.min(REFRESH_COOLDOWN_BASE_MS * 2 ** (failedRefreshes - 1), REFRESH_COOLDOWN_MAX_MS);
}

/**
 * How a refresh ended for the caller: the socket holds a new token, the
 * refresh failed, or the run that asked for it had ended by then.
 */
type RefreshOutcome = 'refreshed' | 'failed' | 'superseded';

/**
 * Refresh state of a failure streak: the failed connection attempts since the
 * client started or the socket last opened.
 */
interface FailureStreak {
  /** A refresh for this streak is pending or has succeeded. */
  refreshSpent: boolean;
  failedRefreshes: number;
  /** Clock time before which the streak does not refresh again. */
  refreshAllowedAt: number;
}

function newFailureStreak(): FailureStreak {
  return { refreshSpent: false, failedRefreshes: 0, refreshAllowedAt: 0 };
}

export function createSocketClient(deps: SocketClientDeps): SocketClient {
  const now = deps.now ?? Date.now;
  let status: SocketStatus = 'disconnected';
  const statusListeners = new Set<(status: SocketStatus) => void>();

  // True from connect() until disconnect(), a cleared session or an invalid one.
  let started = false;
  // Identifies the current run, from connect() to the stop that ends it. Work
  // that awaits captures it and drops its result when the run has ended.
  let run = 0;
  // The run a cleared session ended, until connect() or disconnect() is called.
  let sessionClearedRun: number | null = null;
  // The token the next connection attempt sends. Not null only while started.
  let token: string | null = null;
  let unsubscribeFromTokens: (() => void) | null = null;

  let isOpen = false;
  // Number of connections opened so far. A join compares it to tell a new
  // connection from the one that refused it.
  let openCount = 0;
  let closing = false;
  // Replaced when the socket opens and when the client stops, so a refresh
  // that ends later only writes to the streak that asked for it.
  let streak = newFailureStreak();
  // The pending refresh of the current run.
  let refreshInFlight: Promise<RefreshOutcome> | null = null;

  const socket = deps.createSocket(deps.url, {
    params: () => (token === null ? {} : { token }),
  });

  socket.onOpen(() => {
    isOpen = true;
    openCount += 1;
    streak = newFailureStreak();
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
    // such as no network, settles nothing: the streak refreshes again on the
    // first failed attempt after a cool-down that grows with each failure.
    // The error of a connection this client is closing is ignored.
    const failing = streak;
    if (isOpen || closing || failing.refreshSpent || now() < failing.refreshAllowedAt) return;
    failing.refreshSpent = true;
    void refreshSession().then((outcome) => {
      if (outcome === 'refreshed') return;
      failing.refreshSpent = false;
      failing.failedRefreshes += 1;
      failing.refreshAllowedAt = now() + refreshCooldownMs(failing.failedRefreshes);
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
    run += 1;
    token = null;
    streak = newFailureStreak();
    // A refresh still pending belongs to the run that ends here.
    refreshInFlight = null;
    unsubscribeFromTokens?.();
    unsubscribeFromTokens = null;
    closeTransport();
  }

  function handleTokenChange(next: string | null): void {
    if (!started) return;
    if (next === null) {
      sessionClearedRun = run;
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
   * Refreshes the session for the current run of the socket. A rejected
   * connect and a refused join that ask while that refresh is pending share
   * it; a run never waits on the refresh of an earlier run.
   */
  function refreshSession(): Promise<RefreshOutcome> {
    if (refreshInFlight) return refreshInFlight;
    const refresh = runRefresh(run);
    refreshInFlight = refresh;
    void refresh.then(() => {
      if (refreshInFlight === refresh) refreshInFlight = null;
    });
    return refresh;
  }

  /**
   * A refresh that ends after disconnect() or a later connect() changes
   * nothing: neither the status nor the token of the run that may have started
   * since. A token it did rotate reaches that run through the token store,
   * which announces it.
   */
  async function runRefresh(refreshRun: number): Promise<RefreshOutcome> {
    try {
      const tokens = await deps.refreshTokens();
      if (run !== refreshRun) return 'superseded';
      // Usually a no-op: the token store announces the token before the
      // refresh resolves, and that announcement already restarted the socket.
      handleTokenChange(tokens.accessToken);
      return 'refreshed';
    } catch (error) {
      const sessionInvalid = isSessionInvalidAuthError(error);
      if (run !== refreshRun) {
        // The token store clears an invalid session before the refresh
        // rejects, and that clearing has already stopped this run.
        if (!sessionInvalid || sessionClearedRun !== refreshRun) return 'superseded';
        setStatus('unauthenticated');
        return 'failed';
      }
      if (sessionInvalid) {
        halt();
        setStatus('unauthenticated');
      }
      // Any other failure leaves the socket as it is: Phoenix keeps retrying.
      return 'failed';
    }
  }

  function disconnect(): void {
    sessionClearedRun = null;
    halt();
  }

  async function connect(): Promise<void> {
    if (started) return;
    started = true;
    sessionClearedRun = null;
    const connectRun = run;
    unsubscribeFromTokens = deps.subscribeToAccessToken(handleTokenChange);

    const stored = await deps.getAccessToken().catch(() => null);
    // Nothing left to do when disconnect() or a cleared session ended this
    // run, or when the store announced a token during the read.
    if (run !== connectRun || token !== null) return;
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
          void refreshSession().then((outcome) => {
            if (outcome === 'failed') refuse(error);
            // The client stopped first: the topic refreshes again in its next run.
            if (outcome === 'superseded') refreshedOnOpenCount = null;
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
    disconnect,
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
