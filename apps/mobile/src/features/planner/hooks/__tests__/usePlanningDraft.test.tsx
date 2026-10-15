import React from 'react';
import { act, create } from 'react-test-renderer';
import { createSocketClient, type SocketClient } from '@/api/socket/socketClient';
import {
  createFakeSocket,
  type FakeChannel,
  type FakeSocket,
} from '@/api/socket/testing/fakeSocket';
import generationStarted from '../../fixtures/generationStarted.json';
import planningMessage from '../../fixtures/planningMessage.json';
import proposalReady from '../../fixtures/proposalReady.json';
import startPlanningReply from '../../fixtures/startPlanningReply.json';
import { GENERATION_TIME_LIMIT_MS } from '../../domain/planningDraft';
import { MAX_PLANNING_REQUEST_CHARS } from '../../domain/startPlanning';
import { usePlanningDraft, type PlanningDraftController } from '../usePlanningDraft';
import { usePlanningTopic } from '../usePlanningTopic';

let mockSocketClient: SocketClient;
let mockRequestCount = 0;

jest.mock('@/api/requestId', () => ({
  newRequestId: () => {
    mockRequestCount += 1;
    // The first request is the one the generationStarted fixture answers.
    return mockRequestCount === 1 ? 'req_fixture_1' : `req_${mockRequestCount}`;
  },
}));

jest.mock('@/api/socket', () => ({
  ...jest.requireActual('@/api/socket/topics'),
  getSocketClient: () => mockSocketClient,
}));

jest.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ me: { account: { id: 'account-1' } } }),
}));

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({}));

// The confirm, the reject and the calendar read after a commit are the screen suite's.
jest.mock('../../api/planningApi');
jest.mock('@/features/home/hooks/useLoadLivePlan', () => ({ loadLivePlan: jest.fn() }));

const RANGE = { start: '2030-01-01', end: '2030-01-02' };
const SESSION_ID = generationStarted.sessionId;

let socket: FakeSocket;
let tree: ReturnType<typeof create>;
let controller: PlanningDraftController;
// The clock of the generation time limit, in milliseconds: a test moves it by hand.
let clockMs = 0;
const readClock = () => clockMs;

function Harness() {
  const topic = usePlanningTopic();
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result for assertions.
  controller = usePlanningDraft(topic, readClock);
  return null;
}

function channel(): FakeChannel {
  return socket.channels[0];
}

function pushedEvents(): string[] {
  return channel().pushes.map((push) => push.event);
}

function lastPush() {
  return channel().pushes[channel().pushes.length - 1];
}

function emit(event: string, payload: unknown): void {
  act(() => channel().emit(event, payload));
}

async function replyOk(): Promise<void> {
  await act(async () => lastPush().replyOk(startPlanningReply));
}

beforeEach(() => {
  mockRequestCount = 0;
  clockMs = 0;
  mockSocketClient = createSocketClient({
    url: 'wss://api.example.test/socket',
    createSocket: (url, options) => {
      socket = createFakeSocket(url, options);
      return socket;
    },
    getAccessToken: async () => 'access-1',
    refreshTokens: jest.fn(),
    subscribeToAccessToken: () => () => {},
  });
  act(() => {
    tree = create(<Harness />);
  });
  act(() => channel().replyOk());
});

afterEach(() => {
  act(() => tree.unmount());
});

describe('usePlanningDraft', () => {
  describe('a start push that times out', () => {
    it('keeps generating and is resolved by the events that follow', async () => {
      act(() => controller.start(RANGE, '', []));

      await act(async () => lastPush().timeout());
      expect(controller.draft.status).toBe('generating');

      emit('generation_started', generationStarted);
      emit('proposal_ready', proposalReady);
      emit('planning_message', planningMessage);

      expect(controller.draft.status).toBe('ready');
    });

    it('still fails on an error reply', async () => {
      act(() => controller.start(RANGE, '', []));

      await act(async () =>
        lastPush().replyError({ error: { code: 'planning_invalid_range', message: 'bad' } })
      );

      expect(controller.draft.status).toBe('failed');
    });
  });

  describe('the preselected favorites', () => {
    it('go out with the start under favoriteRecipeIds', () => {
      act(() => controller.start(RANGE, '', ['recipe-a', 'recipe-b']));

      expect(lastPush().payload).toEqual({
        rangeFrom: '2030-01-01',
        rangeTo: '2030-01-02',
        requestId: 'req_fixture_1',
        favoriteRecipeIds: ['recipe-a', 'recipe-b'],
      });
    });

    it('leave the key out when none is selected', () => {
      act(() => controller.start(RANGE, '', []));

      expect(lastPush().payload).not.toHaveProperty('favoriteRecipeIds');
    });
  });

  describe('the request text', () => {
    it('refuses a text over the cap without pushing, as invalid data', () => {
      act(() => controller.start(RANGE, 'x'.repeat(MAX_PLANNING_REQUEST_CHARS + 1), []));

      expect(channel().pushes).toHaveLength(0);
      expect(controller.draft).toMatchObject({
        status: 'failed',
        failure: { kind: 'request', error: { code: 'invalid_payload' } },
      });
    });

    it('counts the trimmed text, so a text at the cap goes through', () => {
      act(() => controller.start(RANGE, ` ${'x'.repeat(MAX_PLANNING_REQUEST_CHARS)} `, []));

      expect(pushedEvents()).toEqual(['start_planning']);
    });

    it('tells the caller once the start is accepted, not before', async () => {
      const accepted = jest.fn();
      act(() => controller.start(RANGE, 'sin carne', [], accepted));
      expect(accepted).not.toHaveBeenCalled();

      await replyOk();

      expect(accepted).toHaveBeenCalledTimes(1);
    });

    it('does not tell the caller about a start the server refuses', async () => {
      const accepted = jest.fn();
      act(() => controller.start(RANGE, 'sin carne', [], accepted));

      await act(async () =>
        lastPush().replyError({ error: { code: 'planning_range_locked', message: 'locked' } })
      );

      expect(accepted).not.toHaveBeenCalled();
    });
  });

  describe('the end of the session', () => {
    it.each(['session_cancelled', 'session_expired', 'session_lost_lock'])(
      'fails the draft on %s of the session it learned',
      async (event) => {
        act(() => controller.start(RANGE, '', []));
        await replyOk();
        emit('generation_started', generationStarted);

        emit(event, { sessionId: 'a-session-of-another-member' });
        expect(controller.draft.status).toBe('generating');

        emit(event, { sessionId: SESSION_ID });
        expect(controller.draft).toMatchObject({
          status: 'failed',
          failure: { kind: 'generation', reason: event },
        });
      }
    );

    it('ignores a payload that does not parse', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      act(() => controller.start(RANGE, '', []));
      emit('generation_started', generationStarted);

      emit('session_cancelled', { session_id: SESSION_ID });

      expect(controller.draft.status).toBe('generating');
      warn.mockRestore();
    });
  });

  describe('a retry after the generation failed', () => {
    async function failGeneration(): Promise<void> {
      act(() => controller.start(RANGE, 'sin carne', []));
      await replyOk();
      emit('generation_started', generationStarted);
      emit('generation_error', {
        reason: 'pipeline_error',
        details: {},
        runId: null,
        requestId: null,
      });
      expect(controller.draft.status).toBe('failed');
    }

    it('cancels the session it learned before it starts again', async () => {
      await failGeneration();

      act(() => controller.retry());

      expect(pushedEvents()).toEqual(['start_planning', 'cancel_planning']);
      expect(lastPush().payload).toEqual({ sessionId: SESSION_ID });
      expect(controller.draft.status).toBe('generating');

      await act(async () => lastPush().replyOk({ sessionId: SESSION_ID, status: 'cancelled' }));

      expect(pushedEvents()).toEqual(['start_planning', 'cancel_planning', 'start_planning']);
      expect(lastPush().payload).toMatchObject({ request: 'sin carne' });
    });

    it('starts anyway when the session is already over', async () => {
      await failGeneration();

      act(() => controller.retry());
      await act(async () =>
        lastPush().replyError({ error: { code: 'not_found', message: 'not active' } })
      );

      expect(pushedEvents()).toEqual(['start_planning', 'cancel_planning', 'start_planning']);
    });

    it('starts anyway when the cancel gets no answer', async () => {
      await failGeneration();

      act(() => controller.retry());
      await act(async () => lastPush().timeout());

      expect(pushedEvents()).toEqual(['start_planning', 'cancel_planning', 'start_planning']);
    });

    it('sends the preselected favorites again, in the same order', async () => {
      act(() => controller.start(RANGE, 'sin carne', ['recipe-b', 'recipe-a']));
      await replyOk();
      emit('generation_started', generationStarted);
      emit('generation_error', {
        reason: 'pipeline_error',
        details: {},
        runId: null,
        requestId: null,
      });

      act(() => controller.retry());
      await act(async () => lastPush().replyOk({ sessionId: SESSION_ID, status: 'cancelled' }));

      expect(pushedEvents()).toEqual(['start_planning', 'cancel_planning', 'start_planning']);
      expect(lastPush().payload).toMatchObject({
        request: 'sin carne',
        favoriteRecipeIds: ['recipe-b', 'recipe-a'],
      });
    });

    it('sends the preselected favorites again after a start the server refused', async () => {
      act(() => controller.start(RANGE, '', ['recipe-a']));
      await act(async () =>
        lastPush().replyError({ error: { code: 'planning_range_locked', message: 'locked' } })
      );

      act(() => controller.retry());

      expect(lastPush().payload).toMatchObject({ favoriteRecipeIds: ['recipe-a'] });
    });

    it('does not cancel anything after a start the server refused', async () => {
      act(() => controller.start(RANGE, '', []));
      await act(async () =>
        lastPush().replyError({ error: { code: 'planning_range_locked', message: 'locked' } })
      );

      act(() => controller.retry());

      expect(pushedEvents()).toEqual(['start_planning', 'start_planning']);
    });
  });

  describe('the generation time limit', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('wakes again when the timer fires before the clock reaches the limit', () => {
      act(() => controller.start(RANGE, '', []));

      clockMs = GENERATION_TIME_LIMIT_MS - 1;
      act(() => {
        jest.advanceTimersByTime(GENERATION_TIME_LIMIT_MS);
      });
      expect(controller.draft.status).toBe('generating');

      clockMs = GENERATION_TIME_LIMIT_MS;
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(controller.draft).toMatchObject({
        status: 'failed',
        failure: { kind: 'generation', reason: 'generation_timed_out' },
      });
    });
  });

  // Issue #146: with the socket down, start_planning gets no answer and no event arrives.
  describe('a start sent while the socket is down', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('fails at the time limit and starts again once the topic is back', async () => {
      // The harness never opens the connection: the socket is down from the start.
      act(() => controller.start(RANGE, '', []));
      await act(async () => lastPush().timeout());
      expect(controller.draft.status).toBe('generating');

      clockMs = GENERATION_TIME_LIMIT_MS;
      act(() => {
        jest.advanceTimersByTime(GENERATION_TIME_LIMIT_MS);
      });
      expect(controller.draft).toMatchObject({
        status: 'failed',
        failure: { kind: 'generation', reason: 'generation_timed_out' },
      });

      act(() => socket.open());
      act(() => channel().replyOk());
      act(() => controller.retry());

      expect(controller.draft.status).toBe('generating');
      expect(lastPush().event).toBe('start_planning');
    });
  });

  // Issue #146: the events of a generation emitted while the socket was down never arrive; the
  // session_resumed the server pushes after the rejoin carries what they would have said.
  describe('the session_resumed of a rejoin', () => {
    const resumedWith = (proposal: unknown, sessionId: string = SESSION_ID) => ({
      sessionId,
      proposalId: proposal === null ? null : proposalReady.proposalId,
      proposal,
      messages: [],
    });

    function rejoin(): void {
      act(() => socket.open());
      act(() => socket.drop());
      act(() => socket.backoffRetry());
      act(() => socket.open());
      act(() => channel().replyOk());
    }

    it('takes the pending proposal of the session the draft generates in', async () => {
      act(() => controller.start(RANGE, '', []));
      await replyOk();
      emit('generation_started', generationStarted);

      rejoin();
      emit('session_resumed', resumedWith(proposalReady));

      expect(controller.draft).toMatchObject({
        status: 'ready',
        sessionId: SESSION_ID,
        proposal: { proposalId: proposalReady.proposalId },
      });
    });

    it('takes it and learns the session when generation_started was lost too', async () => {
      act(() => controller.start(RANGE, '', []));
      await replyOk();

      rejoin();
      emit('session_resumed', resumedWith(proposalReady));

      expect(controller.draft).toMatchObject({ status: 'ready', sessionId: SESSION_ID });
    });

    it('takes it after the generation ran out of time', async () => {
      jest.useFakeTimers();
      act(() => controller.start(RANGE, '', []));
      await replyOk();
      emit('generation_started', generationStarted);
      clockMs = GENERATION_TIME_LIMIT_MS;
      act(() => {
        jest.advanceTimersByTime(GENERATION_TIME_LIMIT_MS);
      });
      expect(controller.draft.status).toBe('failed');
      jest.useRealTimers();

      emit('session_resumed', resumedWith(proposalReady));

      expect(controller.draft).toMatchObject({ status: 'ready', sessionId: SESSION_ID });
    });

    it('keeps generating while the session has no proposal yet', async () => {
      act(() => controller.start(RANGE, '', []));
      await replyOk();
      emit('generation_started', generationStarted);

      emit('session_resumed', resumedWith(null));

      expect(controller.draft.status).toBe('generating');
    });

    it('ignores the session of another member', async () => {
      act(() => controller.start(RANGE, '', []));
      await replyOk();
      emit('generation_started', generationStarted);

      emit('session_resumed', resumedWith(proposalReady, 'a-session-of-another-member'));

      expect(controller.draft.status).toBe('generating');
    });

    it('ignores a proposal of another run', async () => {
      act(() => controller.start(RANGE, '', []));
      await replyOk();
      emit('generation_started', generationStarted);

      emit('session_resumed', resumedWith({ ...proposalReady, runId: 'another-run' }));

      expect(controller.draft.status).toBe('generating');
    });

    it('leaves a draft that is not generating alone', () => {
      emit('session_resumed', resumedWith(proposalReady));

      expect(controller.draft.status).toBe('idle');
    });

    it('keeps generating when the proposal does not parse', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      act(() => controller.start(RANGE, '', []));
      await replyOk();
      emit('generation_started', generationStarted);

      emit('session_resumed', resumedWith({ meals: [] }));

      expect(controller.draft.status).toBe('generating');
      warn.mockRestore();
    });
  });

  describe('a generation left behind before its session was known', () => {
    // The generation of the second request, which the server names in its own generation_started.
    const secondStarted = {
      ...generationStarted,
      requestId: 'req_2',
      runId: 'run-2',
      sessionId: 'session-2',
    };

    function cancelledSessions(): unknown[] {
      return channel()
        .pushes.filter((push) => push.event === 'cancel_planning')
        .map((push) => push.payload);
    }

    it('cancels the session of every generation cancelled that way, once each is known', () => {
      act(() => controller.start(RANGE, '', []));
      act(() => controller.cancel());
      act(() => controller.start(RANGE, '', []));
      act(() => controller.cancel());

      emit('generation_started', generationStarted);
      emit('generation_started', secondStarted);

      expect(cancelledSessions()).toEqual([{ sessionId: SESSION_ID }, { sessionId: 'session-2' }]);
      expect(controller.draft.status).toBe('idle');
    });

    describe('by a retry after an unreadable proposal', () => {
      function failUnreadable(): void {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        act(() => controller.start(RANGE, '', []));
        // A proposal that does not even say its run, before generation_started named the session.
        emit('proposal_ready', {});
        warn.mockRestore();
        expect(controller.draft).toMatchObject({ status: 'failed', sessionId: null });
      }

      it('cancels its session once it is known and leaves the session of the retry alone', () => {
        failUnreadable();

        act(() => controller.retry());
        expect(pushedEvents()).toEqual(['start_planning', 'start_planning']);

        emit('generation_started', generationStarted);
        emit('generation_started', secondStarted);

        expect(cancelledSessions()).toEqual([{ sessionId: SESSION_ID }]);
        expect(controller.draft).toMatchObject({ status: 'generating', sessionId: 'session-2' });
      });

      it('cancels its session before starting again when it was named before the retry', async () => {
        failUnreadable();
        emit('generation_started', generationStarted);

        act(() => controller.retry());

        expect(pushedEvents()).toEqual(['start_planning', 'cancel_planning']);
        expect(lastPush().payload).toEqual({ sessionId: SESSION_ID });

        await act(async () => lastPush().replyOk({ sessionId: SESSION_ID, status: 'cancelled' }));
        emit('generation_started', secondStarted);

        expect(cancelledSessions()).toEqual([{ sessionId: SESSION_ID }]);
      });
    });

    it('forgets a cancelled generation whose start the server refused', async () => {
      act(() => controller.start(RANGE, '', []));
      act(() => controller.cancel());
      await act(async () =>
        lastPush().replyError({ error: { code: 'planning_range_locked', message: 'locked' } })
      );

      emit('generation_started', generationStarted);

      expect(cancelledSessions()).toEqual([]);
    });

    it('logs a cancel the server refuses', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      act(() => controller.start(RANGE, '', []));
      act(() => controller.cancel());
      emit('generation_started', generationStarted);

      await act(async () =>
        lastPush().replyError({ error: { code: 'internal_error', message: 'boom' } })
      );

      expect(warn).toHaveBeenCalledWith(
        '[Planner] Failed to cancel an abandoned generation:',
        expect.anything()
      );
      warn.mockRestore();
    });

    describe('by a retry after the time limit', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      function timeOut(): void {
        act(() => controller.start(RANGE, '', []));
        clockMs = GENERATION_TIME_LIMIT_MS;
        act(() => {
          jest.advanceTimersByTime(GENERATION_TIME_LIMIT_MS);
        });
        expect(controller.draft).toMatchObject({ status: 'failed', sessionId: null });
      }

      it('cancels its session once it is known', () => {
        timeOut();

        act(() => controller.retry());
        // There is no session to cancel yet: the retry starts at once.
        expect(pushedEvents()).toEqual(['start_planning', 'start_planning']);

        emit('generation_started', generationStarted);

        expect(cancelledSessions()).toEqual([{ sessionId: SESSION_ID }]);
        expect(controller.draft).toMatchObject({ status: 'generating', requestId: 'req_2' });
      });

      it('leaves the session of the retry alone', () => {
        timeOut();
        act(() => controller.retry());

        emit('generation_started', secondStarted);

        expect(cancelledSessions()).toEqual([]);
        expect(controller.draft).toMatchObject({ status: 'generating', sessionId: 'session-2' });
      });
    });
  });
});
