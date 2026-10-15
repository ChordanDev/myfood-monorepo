import { ApiError } from '@/api/errors';
import generationError from '../../fixtures/generationError.json';
import generationStarted from '../../fixtures/generationStarted.json';
import planningMessage from '../../fixtures/planningMessage.json';
import proposalReady from '../../fixtures/proposalReady.json';
import {
  parseGenerationError,
  parseGenerationStarted,
  parsePlanningMessage,
  parseProposalReady,
} from '../../types/planningEvents';
import {
  describePlanningFailure,
  describePlanningMessage,
  IDLE_PLANNING_DRAFT,
  planningDraftReducer,
  type PlanningDraft,
  type PlanningDraftAction,
} from '../planningDraft';

// The requestId and runId of the fixtures: the draft that started with this request is the one
// those events belong to.
const REQUEST_ID = 'req_fixture_1';
const started = parseGenerationStarted(generationStarted);
const proposal = parseProposalReady(proposalReady);
const message = parsePlanningMessage(planningMessage);
const error = parseGenerationError(generationError);

function run(actions: PlanningDraftAction[], from: PlanningDraft = IDLE_PLANNING_DRAFT) {
  return actions.reduce(planningDraftReducer, from);
}

const requested: PlanningDraftAction = { type: 'start_requested', requestId: REQUEST_ID };

describe('planningDraftReducer', () => {
  it('starts idle', () => {
    expect(IDLE_PLANNING_DRAFT).toEqual({ status: 'idle' });
  });

  it('is generating from the start request, before the server has answered', () => {
    expect(run([requested])).toMatchObject({ status: 'generating', requestId: REQUEST_ID });
  });

  it('learns the runId from generation_started of its own request', () => {
    const draft = run([requested, { type: 'generation_started', payload: started }]);

    expect(draft).toMatchObject({ status: 'generating', runId: started.runId });
  });

  it('ignores generation_started of another request', () => {
    const draft = run([
      requested,
      { type: 'generation_started', payload: { ...started, requestId: 'someone-else' } },
    ]);

    expect(draft).toMatchObject({ status: 'generating', runId: null });
  });

  it('is ready on the proposal of its run, and adds the assistant message that follows', () => {
    const afterProposal = run([
      requested,
      { type: 'generation_started', payload: started },
      { type: 'proposal_ready', payload: proposal },
    ]);
    expect(afterProposal).toMatchObject({ status: 'ready', message: null });

    const draft = planningDraftReducer(afterProposal, {
      type: 'planning_message',
      payload: message,
    });
    expect(draft).toMatchObject({ status: 'ready', proposal, message });
  });

  it('keeps a message that arrives before the proposal', () => {
    const draft = run([
      requested,
      { type: 'generation_started', payload: started },
      { type: 'planning_message', payload: message },
      { type: 'proposal_ready', payload: proposal },
    ]);

    expect(draft).toMatchObject({ status: 'ready', message });
  });

  it('ignores a proposal or a message of another run', () => {
    const draft = run([
      requested,
      { type: 'generation_started', payload: started },
      { type: 'proposal_ready', payload: { ...proposal, runId: 'other-run' } },
      { type: 'planning_message', payload: { ...message, runId: 'other-run' } },
    ]);

    expect(draft).toMatchObject({ status: 'generating', message: null });
  });

  it('fails on a generation_error of its run', () => {
    const draft = run([
      requested,
      { type: 'generation_started', payload: started },
      { type: 'generation_error', payload: error },
    ]);

    expect(draft).toMatchObject({
      status: 'failed',
      failure: { kind: 'generation', reason: 'no_candidates_for_slot' },
    });
  });

  it('fails on a generation_error that carries its requestId, whatever the run', () => {
    const draft = run([
      requested,
      { type: 'generation_error', payload: { ...error, runId: null, requestId: REQUEST_ID } },
    ]);

    expect(draft.status).toBe('failed');
  });

  it('holds a generation_error that arrives before generation_started, and applies it after', () => {
    const early = run([requested, { type: 'generation_error', payload: error }]);
    expect(early.status).toBe('generating');

    const draft = planningDraftReducer(early, { type: 'generation_started', payload: started });

    expect(draft).toMatchObject({ status: 'failed', failure: { kind: 'generation' } });
  });

  it('drops a held event whose run turns out not to be its own', () => {
    const draft = run([
      requested,
      { type: 'generation_error', payload: { ...error, runId: 'someone-elses-run' } },
      { type: 'generation_started', payload: started },
    ]);

    expect(draft).toMatchObject({ status: 'generating', runId: started.runId });
  });

  it('ignores a generation_error of a run that is not its own', () => {
    const draft = run([
      requested,
      { type: 'generation_started', payload: started },
      { type: 'generation_error', payload: { ...error, runId: 'other-run' } },
    ]);

    expect(draft.status).toBe('generating');
  });

  describe('a generation_error with no run and no request', () => {
    // The engine sends it for reason-only failures, and the account has at most one generation
    // in flight, so it is the failure of the one this draft is waiting for.
    const unattributed = { ...error, runId: null, requestId: null };

    it('fails the draft that waits for generation_started', () => {
      const draft = run([requested, { type: 'generation_error', payload: unattributed }]);

      expect(draft).toMatchObject({
        status: 'failed',
        failure: { kind: 'generation', reason: error.reason },
      });
    });

    it('fails the draft whose run is known', () => {
      const draft = run([
        requested,
        { type: 'generation_started', payload: started },
        { type: 'generation_error', payload: unattributed },
      ]);

      expect(draft).toMatchObject({ status: 'failed', failure: { kind: 'generation' } });
    });

    it('does not touch a draft that is ready', () => {
      const draft = run([
        requested,
        { type: 'generation_started', payload: started },
        { type: 'proposal_ready', payload: proposal },
        { type: 'generation_error', payload: unattributed },
      ]);

      expect(draft.status).toBe('ready');
    });
  });

  describe('the end of the session of the draft', () => {
    const ended = ['session_cancelled', 'session_expired', 'session_lost_lock'] as const;

    it.each(ended)('fails the draft on %s of its session', (type) => {
      const draft = run([
        requested,
        { type: 'generation_started', payload: started },
        { type, payload: { sessionId: started.sessionId } },
      ]);

      expect(draft).toMatchObject({
        status: 'failed',
        sessionId: started.sessionId,
        failure: { kind: 'generation', reason: type },
      });
    });

    it.each(ended)('ignores %s of another session', (type) => {
      const draft = run([
        requested,
        { type: 'generation_started', payload: started },
        { type, payload: { sessionId: 'a-session-of-another-member' } },
      ]);

      expect(draft).toMatchObject({ status: 'generating', sessionId: started.sessionId });
    });

    it('ignores it while the session is not known yet', () => {
      const draft = run([
        requested,
        { type: 'session_cancelled', payload: { sessionId: started.sessionId } },
      ]);

      expect(draft.status).toBe('generating');
    });

    it('keeps the session id in a draft that failed on a generation_error', () => {
      const draft = run([
        requested,
        { type: 'generation_started', payload: started },
        { type: 'generation_error', payload: error },
      ]);

      expect(draft).toMatchObject({ status: 'failed', sessionId: started.sessionId });
    });
  });

  describe('confirming, rejecting and cancelling the proposal', () => {
    const ready = run([
      requested,
      { type: 'generation_started', payload: started },
      { type: 'proposal_ready', payload: proposal },
    ]);
    const committed = {
      sessionId: started.sessionId,
      proposalId: proposal.proposalId,
      scheduledMealsCount: 4,
      shoppingRebuilt: true,
    };

    it('keeps the session of its generation once the proposal is ready', () => {
      expect(ready).toMatchObject({ status: 'ready', sessionId: started.sessionId });
    });

    it('is committed on session_committed of its session, with the meal count', () => {
      const draft = planningDraftReducer(ready, { type: 'session_committed', payload: committed });

      expect(draft).toEqual({
        status: 'committed',
        requestId: REQUEST_ID,
        sessionId: started.sessionId,
        scheduledMealsCount: 4,
      });
    });

    it('ignores session_committed of another session', () => {
      const draft = planningDraftReducer(ready, {
        type: 'session_committed',
        payload: { ...committed, sessionId: 'a-session-of-another-member' },
      });

      expect(draft).toBe(ready);
    });

    it('is idle again when its session is cancelled', () => {
      const draft = planningDraftReducer(ready, {
        type: 'session_cancelled',
        payload: { sessionId: started.sessionId },
      });

      expect(draft).toEqual(IDLE_PLANNING_DRAFT);
    });

    it.each(['session_expired', 'session_lost_lock'] as const)(
      'fails when its session ends on %s',
      (type) => {
        const draft = planningDraftReducer(ready, {
          type,
          payload: { sessionId: started.sessionId },
        });

        expect(draft).toMatchObject({ status: 'failed', failure: { reason: type } });
      }
    );

    it('is idle again on reset', () => {
      expect(planningDraftReducer(ready, { type: 'reset' })).toEqual(IDLE_PLANNING_DRAFT);
    });
  });

  it('fails with the error of a rejected start request', () => {
    const rejection = new ApiError('planning_invalid_range', 'bad range', 0);

    const draft = run([
      requested,
      { type: 'start_rejected', requestId: REQUEST_ID, error: rejection },
    ]);

    expect(draft).toMatchObject({
      status: 'failed',
      failure: { kind: 'request', error: rejection },
    });
  });

  it('prefers the reply error over a generation_error of the same request', () => {
    const rejection = new ApiError('generation_in_progress', 'busy', 0);

    const draft = run([
      requested,
      { type: 'generation_error', payload: { ...error, requestId: REQUEST_ID } },
      { type: 'start_rejected', requestId: REQUEST_ID, error: rejection },
    ]);

    expect(draft).toMatchObject({
      status: 'failed',
      failure: { kind: 'request', error: rejection },
    });
  });

  it('ignores the rejection of an earlier request', () => {
    const draft = run([
      requested,
      {
        type: 'start_rejected',
        requestId: 'earlier',
        error: new ApiError('planning_invalid_range', 'bad', 0),
      },
    ]);

    expect(draft.status).toBe('generating');
  });

  it('starts again from a failed draft', () => {
    const failed = run([
      requested,
      { type: 'start_rejected', requestId: REQUEST_ID, error: new ApiError('timeout', 't', 0) },
    ]);

    const draft = planningDraftReducer(failed, { type: 'start_requested', requestId: 'req-2' });

    expect(draft).toMatchObject({ status: 'generating', requestId: 'req-2', runId: null });
  });

  it('ignores run events while idle', () => {
    expect(run([{ type: 'proposal_ready', payload: proposal }])).toEqual(IDLE_PLANNING_DRAFT);
  });
});

describe('describePlanningFailure', () => {
  it('names the owner of a locked range', () => {
    const failure = {
      kind: 'request' as const,
      error: new ApiError('planning_range_locked', 'locked', 0, { ownerName: 'Ana Peer' }),
    };

    expect(describePlanningFailure(failure)).toBe(
      'Ana Peer ya tiene una planificación en curso para esas fechas.'
    );
  });

  it('falls back to the plain text of a locked range without an owner', () => {
    const failure = {
      kind: 'request' as const,
      error: new ApiError('planning_range_locked', 'locked', 0),
    };

    expect(describePlanningFailure(failure)).toBe(
      'Esas fechas ya están en una planificación en curso.'
    );
  });

  it('says what range the server accepts when the range is invalid', () => {
    const failure = {
      kind: 'request' as const,
      error: new ApiError('planning_invalid_range', 'x', 0),
    };

    expect(describePlanningFailure(failure)).toBe(
      'Elegí entre 1 y 7 días, empezando hoy o más adelante.'
    );
  });

  it('explains a generation reason the app knows', () => {
    expect(describePlanningFailure({ kind: 'generation', reason: 'optimization_failed' })).toBe(
      'No pudimos armar un menú con esas condiciones. Probá con otras.'
    );
  });

  it('falls back to a generic text for a reason it does not know', () => {
    expect(describePlanningFailure({ kind: 'generation', reason: 'no_candidates_for_slot' })).toBe(
      'No pudimos armar tu menú. Probá de nuevo.'
    );
  });
});

describe('describePlanningMessage', () => {
  it('words the first proposal in Spanish from its summary, without the cost', () => {
    expect(describePlanningMessage(message.summary)).toBe(
      'Acá tenés tu menú para 2 días: 3 comidas.'
    );
  });

  it('uses the singular for one day and one meal', () => {
    expect(describePlanningMessage({ dayCount: 1, mealCount: 1, estimatedCostCents: 500 })).toBe(
      'Acá tenés tu menú para 1 día: 1 comida.'
    );
  });
});
