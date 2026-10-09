import { errorFromEnvelope, isSessionInvalidAuthError, type ApiError } from '../errors';

/**
 * The part of the Phoenix client this module calls. Depending on these shapes
 * instead of the `phoenix` classes lets a test inject a fake socket.
 */
export interface PhoenixPush {
  receive(status: 'ok' | 'error', callback: (response: unknown) => void): PhoenixPush;
}

export interface PhoenixChannel {
  /** Binds `callback` to an event the server pushes on the topic. The binding survives rejoins. */
  on(event: string, callback: (payload: unknown) => void): unknown;
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
 * `connected` while the socket is open. `unauthenticated` once a refresh found
 * the session invalid, until the token store announces a new access token.
 * `disconnected` in every other case: not started, no session, or connecting.
 */
export type SocketStatus = 'connected' | 'disconnected' | 'unauthenticated';

export interface TopicJoinHandlers {
  /** The server accepted the join. Called again when the topic rejoins after a reconnect. */
  onJoined?: () => void;
  /** The server refused the join. The topic has been left and is not retried. */
  onRefused?: (error: ApiError) => void;
  /**
   * Handlers of the events the server pushes on the topic, by event name. They are bound before
   * the join, so an event pushed right after it is not missed, and they stay bound when the
   * topic rejoins after a reconnect.
   */
  events?: Record<string, (payload: unknown) => void>;
}

export interface TopicSubscription {
  /** Listens for a server event on the topic. Returns the function that stops listening. */
  on(event: string, callback: (payload: unknown) => void): () => void;
  leave(): void;
}

export interface SocketClient {
  /**
   * Keeps the socket connected whenever a session exists, until `disconnect()`.
   * It opens with the stored access token, closes when the session is cleared
   * or found invalid, and opens again when the token store announces a new
   * access token; the topics still joined then rejoin. Without a stored
   * session it waits for that announcement. Never rejects.
   */
  connect(): Promise<void>;
  /** Closes the socket and stops following the session. */
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
 * Wait before another refresh may start after one that failed for a transient
 * reason. It starts at Phoenix's longest reconnect delay and doubles per
 * failure: 5 s, 10 s, 20 s, 40 s, then 60 s. Every refresh is a rotation
 * request for the refresh token, and one whose response is lost can leave the
 * stored token stale, so an outage must not send one per reconnect attempt or
 * per rejoin.
 */
const REFRESH_COOLDOWN_BASE_MS = 5_000;
const REFRESH_COOLDOWN_MAX_MS = 60_000;

/**
 * Wait before another refresh may start after one that succeeded while the
 * socket still cannot open. A server that refuses a token this fresh is not
 * refusing it for the token, so refreshing again at once would only rotate
 * the session. Ten minutes is far below the one hour an access token lives,
 * so a socket that keeps failing never sends an expired token, and it costs
 * at most six rotations an hour.
 */
const REFRESH_HOLD_AFTER_SUCCESS_MS = 10 * 60_000;

function refreshCooldownMs(failedRefreshes: number): number {
  return Math.min(REFRESH_COOLDOWN_BASE_MS * 2 ** (failedRefreshes - 1), REFRESH_COOLDOWN_MAX_MS);
}

/**
 * How a refresh ended for the caller: the socket holds a new token, the
 * refresh failed for a transient reason, the session is invalid, or the
 * session the refresh was for had ended by then.
 */
type RefreshOutcome = 'refreshed' | 'failed' | 'session_invalid' | 'superseded';

/**
 * The refreshes the socket may still ask for. Rejected connects and refused
 * joins draw on the same budget, because both send rotation requests.
 */
interface RefreshBudget {
  /** Refreshes that failed for a transient reason since the last one that succeeded. */
  failedRefreshes: number;
  /** Clock time before which no refresh starts. */
  refreshAllowedAt: number;
}

function newRefreshBudget(): RefreshBudget {
  return { failedRefreshes: 0, refreshAllowedAt: 0 };
}

export function createSocketClient(deps: SocketClientDeps): SocketClient {
  const now = deps.now ?? Date.now;
  let status: SocketStatus = 'disconnected';
  const statusListeners = new Set<(status: SocketStatus) => void>();

  // True from connect() to disconnect(). A started client follows the token
  // store, also while it has no session and therefore no connection.
  let started = false;
  // Identifies the current run: it moves on whenever the session is lost and
  // on disconnect(). Work that awaits captures it and drops its result when
  // the run has ended.
  let run = 0;
  // The run a cleared session ended, until a new token or disconnect().
  let sessionClearedRun: number | null = null;
  // The token the next connection attempt sends; null while there is no session.
  let token: string | null = null;
  let unsubscribeFromTokens: (() => void) | null = null;

  let isOpen = false;
  // Number of connections opened so far. A join compares it to tell a new
  // connection from the one that refused it.
  let openCount = 0;
  let closing = false;
  // Replaced when the socket opens and when the run ends, so a refresh that
  // ends later only writes to the budget it drew on.
  let budget = newRefreshBudget();
  // The pending refresh of the current run.
  let refreshInFlight: Promise<RefreshOutcome> | null = null;

  const socket = deps.createSocket(deps.url, {
    params: () => (token === null ? {} : { token }),
  });

  socket.onOpen(() => {
    isOpen = true;
    openCount += 1;
    budget = newRefreshBudget();
    setStatus('connected');
  });

  socket.onClose(markClosed);

  socket.onError(() => {
    // The server refuses the WebSocket upgrade of an invalid token without a
    // readable reason, so an error before the socket opened is treated as a
    // possible rejection and answered with a refresh. Phoenix keeps retrying
    // on its backoff and every failed attempt reports an error; the refresh
    // budget decides which of them refresh. The error of a connection this
    // client is closing is ignored.
    if (isOpen || closing) return;
    // The outcome acts on the socket itself: it reconnects or closes it.
    void requestRefresh();
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

  function connectSocket(): void {
    try {
      socket.connect();
    } catch {
      // A transport that cannot be created leaves the client disconnected. The
      // next token change tries again.
    }
  }

  function openTransport(): void {
    // A teardown in progress connects when it finishes.
    if (!closing) connectSocket();
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
      if (token !== null) connectSocket();
    });
  }

  function adoptToken(next: string): void {
    token = next;
    sessionClearedRun = null;
    if (status === 'unauthenticated') setStatus('disconnected');
  }

  /**
   * Ends the run: the session is gone or the client is stopping. The socket
   * closes and nothing that was started before this point applies any more.
   */
  function dropSession(): void {
    run += 1;
    token = null;
    budget = newRefreshBudget();
    // A refresh still pending belongs to the run that ends here.
    refreshInFlight = null;
    closeTransport();
  }

  function handleTokenChange(next: string | null): void {
    if (!started) return;
    if (next === null) {
      if (token !== null) sessionClearedRun = run;
      dropSession();
      return;
    }
    if (next === token) return;
    // The server keeps the token the socket connected with, so a new token
    // needs a new connection. Phoenix rejoins the joined topics once it opens.
    adoptToken(next);
    closeTransport();
  }

  /**
   * Asks for a refresh of the session on behalf of a rejected connect or a
   * refused join. Returns null when the budget does not allow one yet.
   *
   * One refresh runs at a time and callers that ask meanwhile share it; a run
   * never waits on the refresh of an earlier run. After a refresh that failed
   * for a transient reason, such as no network, the next one waits for a
   * cool-down that grows with each failure. After one that succeeded, the next
   * one waits `REFRESH_HOLD_AFTER_SUCCESS_MS`. The budget starts over when the
   * socket opens and when the run ends.
   */
  function requestRefresh(): Promise<RefreshOutcome> | null {
    if (refreshInFlight) return refreshInFlight;
    const spent = budget;
    if (now() < spent.refreshAllowedAt) return null;

    const refresh = runRefresh(run).then((outcome) => {
      if (outcome === 'refreshed') {
        spent.failedRefreshes = 0;
        spent.refreshAllowedAt = now() + REFRESH_HOLD_AFTER_SUCCESS_MS;
      } else if (outcome === 'failed') {
        spent.failedRefreshes += 1;
        spent.refreshAllowedAt = now() + refreshCooldownMs(spent.failedRefreshes);
      }
      return outcome;
    });
    refreshInFlight = refresh;
    void refresh.then(() => {
      if (refreshInFlight === refresh) refreshInFlight = null;
    });
    return refresh;
  }

  /**
   * A refresh that ends after its run changes nothing: neither the status nor
   * the token of the run that may have started since. A token it did rotate
   * reaches that run through the token store, which announces it.
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
        // rejects, and that clearing has already ended this run.
        if (!sessionInvalid || sessionClearedRun !== refreshRun) return 'superseded';
        setStatus('unauthenticated');
        return 'session_invalid';
      }
      if (!sessionInvalid) return 'failed';
      dropSession();
      setStatus('unauthenticated');
      return 'session_invalid';
    }
  }

  function disconnect(): void {
    if (!started) return;
    started = false;
    sessionClearedRun = null;
    unsubscribeFromTokens?.();
    unsubscribeFromTokens = null;
    dropSession();
  }

  async function connect(): Promise<void> {
    if (started) return;
    try {
      unsubscribeFromTokens = deps.subscribeToAccessToken(handleTokenChange);
    } catch {
      // A client that cannot follow the token store is not started.
      return;
    }
    started = true;
    const connectRun = run;

    const stored = await deps.getAccessToken().catch(() => null);
    // Nothing to open when disconnect() or a cleared session ended this run,
    // when the store announced a token during the read, or when there is no
    // session yet: the client then waits for the store to announce one.
    if (run !== connectRun || token !== null || stored === null) return;
    adoptToken(stored);
    openTransport();
  }

  function joinTopic(topic: string, handlers: TopicJoinHandlers = {}): TopicSubscription {
    const channel = socket.channel(topic);
    let left = false;
    // The connection whose `unauthenticated` refusal was answered with a
    // refresh that succeeded; null while no refresh has been spent on the join.
    let refreshedOnOpenCount: number | null = null;

    // One binding per event name on the channel, fanned out to the handlers listening to it:
    // the channel keeps its bindings when Phoenix rejoins it, so nothing is bound again.
    const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

    function on(event: string, callback: (payload: unknown) => void): () => void {
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        const bound = new Set<(payload: unknown) => void>();
        handlers = bound;
        eventHandlers.set(event, bound);
        channel.on(event, (payload) => {
          if (left) return;
          [...bound].forEach((handler) => handler(payload));
        });
      }
      const listeners = handlers;
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }

    function leave(): void {
      if (left) return;
      left = true;
      channel.leave();
    }

    Object.entries(handlers.events ?? {}).forEach(([event, handler]) => on(event, handler));

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
        // The socket outlived its access token. Until this topic is left,
        // Phoenix rejoins it on a timer and whenever the socket reopens, so
        // every refusal that is not final only has to wait for the next one.
        if (refreshedOnOpenCount !== null) {
          // Final on the connection the refreshed token opened. The rejoin
          // timer can still fire on the stale one before it closes.
          if (refreshedOnOpenCount !== openCount) refuse(error);
          return;
        }
        const refusedOnOpenCount = openCount;
        const refresh = requestRefresh();
        // Null while the budget allows no refresh, as in the cool-down of one
        // that failed: a later refusal asks again.
        if (refresh === null) return;
        void refresh.then((outcome) => {
          if (outcome === 'refreshed') refreshedOnOpenCount = refusedOnOpenCount;
          if (outcome === 'session_invalid') refuse(error);
        });
      });

    return { on, leave };
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
