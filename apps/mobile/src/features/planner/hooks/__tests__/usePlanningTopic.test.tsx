import React from 'react';
import { act, create } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { createSocketClient, type SocketClient } from '@/api/socket/socketClient';
import { createFakeSocket, type FakeSocket } from '@/api/socket/testing/fakeSocket';
import { usePlanningTopic, type PlanningTopicState } from '../usePlanningTopic';

let mockSocketClient: SocketClient;
let mockAccountId: string | null = null;

// The real barrel would load the app client, and with it the Phoenix client.
jest.mock('@/api/socket', () => ({
  ...jest.requireActual('@/api/socket/topics'),
  getSocketClient: () => mockSocketClient,
}));

jest.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ me: mockAccountId === null ? null : { account: { id: mockAccountId } } }),
}));

function refusal(code: string) {
  return { error: { code, message: 'refused' } };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

let socket: FakeSocket;
let storedToken: string | null;
const tokenListeners = new Set<(accessToken: string | null) => void>();
let tree: ReturnType<typeof create> | undefined;
let planningTopic: PlanningTopicState;

function HookHarness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  planningTopic = usePlanningTopic();
  return null;
}

/** Renders the hook for `accountId`, or renders it again once the Account has changed. */
async function renderPlanningTopic(accountId: string | null, strict = false) {
  mockAccountId = accountId;
  const element = strict ? (
    <React.StrictMode>
      <HookHarness />
    </React.StrictMode>
  ) : (
    <HookHarness />
  );

  await act(async () => {
    if (tree) tree.update(element);
    else tree = create(element);
    // The client reads the stored token before it opens the socket.
    await flushPromises();
  });
}

/** Plays the token store when a session starts: stores the token, then tells the subscribers. */
function announceToken(accessToken: string): void {
  storedToken = accessToken;
  [...tokenListeners].forEach((listener) => listener(accessToken));
}

function liveChannels() {
  return socket.channels.filter((channel) => !channel.hasLeft());
}

beforeEach(() => {
  mockAccountId = null;
  storedToken = 'access-1';
  tokenListeners.clear();
  mockSocketClient = createSocketClient({
    url: 'wss://api.example.test/socket',
    createSocket: (url, options) => {
      socket = createFakeSocket(url, options);
      return socket;
    },
    getAccessToken: async () => storedToken,
    refreshTokens: jest.fn(),
    subscribeToAccessToken: (listener) => {
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },
  });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

describe('usePlanningTopic', () => {
  it("connects the app socket and joins the Account's planning topic on mount", async () => {
    await renderPlanningTopic('account-1');

    expect(socket.connectAttempts).toEqual([{ token: 'access-1' }]);
    expect(socket.channels.map((channel) => channel.topic)).toEqual(['planning:account-1']);
    expect(planningTopic).toEqual({ status: 'joining' });
  });

  it('reports the topic as joined once the server accepts the join', async () => {
    await renderPlanningTopic('account-1');
    socket.open();

    act(() => socket.channels[0].replyOk());

    expect(planningTopic).toEqual({ status: 'joined' });
  });

  it('joins once the session arrives after mount for the same Account', async () => {
    storedToken = null;
    await renderPlanningTopic('account-1');
    expect(socket.connectAttempts).toEqual([]);
    expect(planningTopic).toEqual({ status: 'joining' });

    act(() => announceToken('access-2'));
    expect(socket.connectAttempts).toEqual([{ token: 'access-2' }]);
    socket.open();
    act(() => socket.channels[0].replyOk());

    expect(socket.channels).toHaveLength(1);
    expect(planningTopic).toEqual({ status: 'joined' });
  });

  it.each(['forbidden', 'trial_expired'] as const)(
    'reports a join refused as %s with the error of the envelope',
    async (code) => {
      await renderPlanningTopic('account-1');
      socket.open();

      act(() => socket.channels[0].replyError(refusal(code)));

      expect(planningTopic.status).toBe('refused');
      const { error } = planningTopic as Extract<PlanningTopicState, { status: 'refused' }>;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe(code);
      expect(socket.channels[0].hasLeft()).toBe(true);
    }
  );

  it('leaves the topic on unmount and keeps the app socket connected', async () => {
    await renderPlanningTopic('account-1');
    socket.open();
    act(() => socket.channels[0].replyOk());

    act(() => tree?.unmount());

    expect(socket.channels[0].hasLeft()).toBe(true);
    expect(socket.disconnectCount).toBe(0);
    expect(mockSocketClient.getStatus()).toBe('connected');
  });

  it('does nothing without an Account id', async () => {
    await renderPlanningTopic(null);

    expect(socket.connectAttempts).toEqual([]);
    expect(socket.channels).toEqual([]);
    expect(planningTopic).toEqual({ status: 'idle' });
  });

  it('leaves the topic and joins the new one when the Account id changes', async () => {
    await renderPlanningTopic('account-1');
    socket.open();
    act(() => socket.channels[0].replyOk());

    await renderPlanningTopic('account-2');

    expect(socket.channels.map((channel) => channel.topic)).toEqual([
      'planning:account-1',
      'planning:account-2',
    ]);
    expect(socket.channels[0].hasLeft()).toBe(true);
    expect(socket.channels[1].hasLeft()).toBe(false);
    // The answer of the previous Account's topic says nothing about this one.
    expect(planningTopic).toEqual({ status: 'joining' });
    expect(socket.disconnectCount).toBe(0);

    act(() => socket.channels[1].replyOk());

    expect(planningTopic).toEqual({ status: 'joined' });
  });

  it('leaves the topic when the Account id is gone', async () => {
    await renderPlanningTopic('account-1');

    await renderPlanningTopic(null);

    expect(socket.channels).toHaveLength(1);
    expect(socket.channels[0].hasLeft()).toBe(true);
    expect(planningTopic).toEqual({ status: 'idle' });
  });

  it('clears a refusal when the topic is joined again', async () => {
    await renderPlanningTopic('account-1');
    socket.open();
    act(() => socket.channels[0].replyError(refusal('forbidden')));
    expect(planningTopic.status).toBe('refused');

    await renderPlanningTopic(null);
    await renderPlanningTopic('account-1');

    expect(planningTopic).toEqual({ status: 'joining' });

    act(() => socket.channels[1].replyOk());

    expect(planningTopic).toEqual({ status: 'joined' });
  });

  it('stays joined when the topic rejoins after a reconnect', async () => {
    await renderPlanningTopic('account-1');
    socket.open();
    act(() => socket.channels[0].replyOk());

    act(() => {
      socket.drop();
      socket.backoffRetry();
      socket.open();
      socket.channels[0].replyOk();
    });

    expect(socket.channels).toHaveLength(1);
    expect(planningTopic).toEqual({ status: 'joined' });
  });

  it('holds a single subscription when StrictMode runs the effect twice', async () => {
    await renderPlanningTopic('account-1', true);

    expect(socket.channels.map((channel) => channel.topic)).toEqual([
      'planning:account-1',
      'planning:account-1',
    ]);
    expect(liveChannels()).toEqual([socket.channels[1]]);
    expect(socket.connectAttempts).toEqual([{ token: 'access-1' }]);

    socket.open();
    act(() => liveChannels()[0].replyOk());

    expect(planningTopic).toEqual({ status: 'joined' });
  });
});
