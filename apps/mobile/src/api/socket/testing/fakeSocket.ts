import type {
  PhoenixChannel,
  PhoenixPush,
  PhoenixSocket,
  PhoenixSocketOptions,
} from '../socketClient';

/**
 * Test double for the Phoenix client. It reproduces the parts of the real
 * `Socket` and `Channel` the socket client relies on, and lets a test play the
 * server and the network: accept or refuse a connection, drop it, and reply to
 * a join.
 *
 * It does not run Phoenix's timers. A test stands in for the reconnect backoff
 * with `backoffRetry()` and for a channel rejoin by replying to the join again.
 */
export interface FakeSocket extends PhoenixSocket {
  readonly url: string;
  /** The params sent on each connection attempt, oldest first. */
  readonly connectAttempts: readonly Record<string, unknown>[];
  /** Every channel created on this socket, oldest first. */
  readonly channels: readonly FakeChannel[];
  readonly disconnectCount: number;
  /** The server accepts the pending connection attempt. */
  open(): void;
  /** The server refuses the pending attempt: an error, then a close, never an open. */
  failBeforeOpen(): void;
  /** An open connection is lost: an error, then a close. */
  drop(): void;
  /** Phoenix's reconnect timer fires and starts a new attempt after a failed or lost connection. */
  backoffRetry(): void;
  /**
   * Makes the next `disconnect()` calls behave as a teardown whose connection
   * is slow to close: Phoenix detaches its handlers before the close event
   * arrives, so none is reported, and the callback waits.
   */
  deferDisconnects(): void;
  /** Runs the held teardown callbacks, oldest first. */
  finishDisconnects(): void;
  /** Makes the next `connect()` throw, as a transport that cannot be created does. */
  failNextConnect(error: Error): void;
}

/** A message the client pushed on a channel, waiting for the server's answer. */
export interface FakePush {
  readonly event: string;
  readonly payload: unknown;
  /** The server answers the push with `response`. */
  replyOk(response?: unknown): void;
  /** The server answers the push with an error, usually an envelope. */
  replyError(response: unknown): void;
  /** The server does not answer in time. */
  timeout(): void;
}

export interface FakeChannel extends PhoenixChannel {
  readonly topic: string;
  /** Every message pushed on this channel, oldest first. */
  readonly pushes: readonly FakePush[];
  /** The server pushes `event` to the channel. Dropped once the channel has left. */
  emit(event: string, payload: unknown): void;
  hasLeft(): boolean;
  /** The server accepts the join, or the rejoin that follows a reconnect. */
  replyOk(response?: unknown): void;
  /** The server refuses the join with `response`. */
  replyError(response: unknown): void;
}

type Connection = 'none' | 'connecting' | 'open' | 'lost';
type JoinStatus = 'ok' | 'error' | 'timeout';

function createFakeChannel(topic: string): FakeChannel {
  const pushes: FakePush[] = [];
  const listeners = new Map<string, Map<number, (payload: unknown) => void>>();
  let nextRef = 1;
  let joined = false;
  let left = false;

  function createPush(): { push: PhoenixPush; deliver: (status: JoinStatus, r: unknown) => void } {
    const pushHooks: { status: JoinStatus; callback: (response: unknown) => void }[] = [];
    const push: PhoenixPush = {
      receive(status, callback) {
        pushHooks.push({ status, callback });
        return push;
      },
    };
    return {
      push,
      deliver: (status, response) =>
        pushHooks
          .filter((hook) => hook.status === status)
          .forEach((hook) => hook.callback(response)),
    };
  }

  const joinPush = createPush();
  const push = joinPush.push;

  function reply(status: JoinStatus, response: unknown): void {
    if (!joined) throw new Error(`FakeChannel ${topic}: replied before join()`);
    // The real channel is removed from its socket once it leaves.
    if (left) return;
    joinPush.deliver(status, response);
  }

  return {
    topic,
    pushes,
    push(event, payload) {
      if (!joined) throw new Error(`FakeChannel ${topic}: push() before join()`);
      const { push: pushed, deliver } = createPush();
      pushes.push({
        event,
        payload,
        replyOk: (response = {}) => deliver('ok', response),
        replyError: (response) => deliver('error', response),
        timeout: () => deliver('timeout', {}),
      });
      return pushed;
    },
    on(event, callback) {
      const ref = nextRef++;
      const byRef = listeners.get(event) ?? new Map<number, (payload: unknown) => void>();
      byRef.set(ref, callback);
      listeners.set(event, byRef);
      return ref;
    },
    off(event, ref) {
      listeners.get(event)?.delete(ref);
    },
    emit(event, payload) {
      if (left) return;
      [...(listeners.get(event)?.values() ?? [])].forEach((callback) => callback(payload));
    },
    hasLeft: () => left,
    join() {
      if (joined) throw new Error(`FakeChannel ${topic}: join() called twice`);
      joined = true;
      return push;
    },
    leave() {
      left = true;
    },
    replyOk: (response = {}) => reply('ok', response),
    replyError: (response) => reply('error', response),
  };
}

export function createFakeSocket(url: string, options: PhoenixSocketOptions): FakeSocket {
  const connectAttempts: Record<string, unknown>[] = [];
  const channels: FakeChannel[] = [];
  const openCallbacks: (() => void)[] = [];
  const closeCallbacks: (() => void)[] = [];
  const errorCallbacks: (() => void)[] = [];
  const heldDisconnects: (() => void)[] = [];
  let connection: Connection = 'none';
  let disconnectCount = 0;
  let deferring = false;
  let connectError: Error | null = null;

  const emit = (callbacks: (() => void)[]) => callbacks.forEach((callback) => callback());

  function expectConnection(expected: Connection, action: string): void {
    if (connection !== expected) {
      throw new Error(`FakeSocket: ${action} needs a ${expected} connection, got ${connection}`);
    }
  }

  function connect(): void {
    // Like the real socket, a second connect() is ignored while a connection
    // object exists, even a failed one waiting for the reconnect timer.
    if (connection !== 'none') return;
    if (connectError) {
      const error = connectError;
      connectError = null;
      throw error;
    }
    connection = 'connecting';
    connectAttempts.push({ ...options.params() });
  }

  return {
    url,
    connectAttempts,
    channels,
    get disconnectCount() {
      return disconnectCount;
    },
    connect,
    disconnect(callback) {
      disconnectCount += 1;
      const previous = connection;
      connection = 'none';
      if (deferring) {
        if (callback) heldDisconnects.push(callback);
        return;
      }
      // Closing a WebSocket that is still connecting fails it: an error, then a close.
      if (previous === 'connecting') emit(errorCallbacks);
      if (previous === 'connecting' || previous === 'open') emit(closeCallbacks);
      callback?.();
    },
    onOpen: (callback) => openCallbacks.push(callback),
    onClose: (callback) => closeCallbacks.push(callback),
    onError: (callback) => errorCallbacks.push(callback),
    channel(topic) {
      const channel = createFakeChannel(topic);
      channels.push(channel);
      return channel;
    },
    open() {
      expectConnection('connecting', 'open()');
      connection = 'open';
      emit(openCallbacks);
    },
    failBeforeOpen() {
      expectConnection('connecting', 'failBeforeOpen()');
      connection = 'lost';
      emit(errorCallbacks);
      emit(closeCallbacks);
    },
    drop() {
      expectConnection('open', 'drop()');
      emit(errorCallbacks);
      connection = 'lost';
      emit(closeCallbacks);
    },
    backoffRetry() {
      expectConnection('lost', 'backoffRetry()');
      connection = 'none';
      connect();
    },
    deferDisconnects() {
      deferring = true;
    },
    finishDisconnects() {
      deferring = false;
      heldDisconnects.splice(0).forEach((callback) => callback());
    },
    failNextConnect(error) {
      connectError = error;
    },
  };
}
