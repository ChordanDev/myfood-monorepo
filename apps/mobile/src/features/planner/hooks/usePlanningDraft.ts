import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, isApiError } from '@/api/errors';
import { newRequestId } from '@/api/requestId';
import type { CalendarRange } from '@/features/home';
import { loadLivePlan } from '@/features/home/hooks/useLoadLivePlan';
import { confirmProposal, rejectProposal } from '../api/planningApi';
import {
  generationDeadline,
  IDLE_PLANNING_DRAFT,
  planningDraftReducer,
  type PlanningDraft,
  type PlanningDraftAction,
} from '../domain/planningDraft';
import { buildStartPlanningParams, isPlanningRequestTooLong } from '../domain/startPlanning';
import {
  parseGenerationError,
  parseGenerationStarted,
  parsePlanningMessage,
  parseProposalReady,
  parseSessionCancelled,
  parseSessionCommitted,
  parseSessionExpired,
  parseSessionLostLock,
  parseStartPlanningReply,
} from '../types/planningEvents';
import type { PlanningTopicState } from './usePlanningTopic';

// The events of the planning topic that move the draft, each with the parser that vouches for its
// payload and the action it becomes.
const DRAFT_EVENTS: {
  event: string;
  toAction: (payload: unknown) => PlanningDraftAction;
}[] = [
  {
    event: 'generation_started',
    toAction: (payload) => ({
      type: 'generation_started',
      payload: parseGenerationStarted(payload),
    }),
  },
  // A proposal that does not parse fails its generation: nothing else will answer it.
  {
    event: 'proposal_ready',
    toAction: (payload) => {
      try {
        return { type: 'proposal_ready', payload: parseProposalReady(payload) };
      } catch (error) {
        console.warn('[Planner] Failed the draft on a malformed proposal_ready:', error);
        return { type: 'proposal_unreadable', payload: { runId: readRunId(payload) } };
      }
    },
  },
  {
    event: 'planning_message',
    toAction: (payload) => ({ type: 'planning_message', payload: parsePlanningMessage(payload) }),
  },
  {
    event: 'generation_error',
    toAction: (payload) => ({ type: 'generation_error', payload: parseGenerationError(payload) }),
  },
  // The session of the draft ending is the end of its generation: nothing else will answer.
  {
    event: 'session_cancelled',
    toAction: (payload) => ({ type: 'session_cancelled', payload: parseSessionCancelled(payload) }),
  },
  {
    event: 'session_expired',
    toAction: (payload) => ({ type: 'session_expired', payload: parseSessionExpired(payload) }),
  },
  {
    event: 'session_lost_lock',
    toAction: (payload) => ({ type: 'session_lost_lock', payload: parseSessionLostLock(payload) }),
  },
  // The commit of the draft's session, also when the reply of its confirm was lost on the way.
  {
    event: 'session_committed',
    toAction: (payload) => ({ type: 'session_committed', payload: parseSessionCommitted(payload) }),
  },
];

// The run id of a payload that did not parse, if it still carries one.
function readRunId(payload: unknown): string | null {
  const runId = (payload as { runId?: unknown } | null)?.runId;
  return typeof runId === 'string' ? runId : null;
}

/** What the User asked to do with a ready proposal. */
export type PlanningAction = 'confirm' | 'reject' | 'cancel';

// How a confirm ends without an answer: the server may still have committed it.
const UNANSWERED_CODES: readonly string[] = ['unknown_error', 'network_error', 'timeout'];

export interface PlanningDraftController {
  draft: PlanningDraft;
  /**
   * Starts planning `range` with the optional free-text `request` and the ids of the Favorite
   * recipes the User preselected. Does nothing while the topic is not joined or no day is picked.
   * `onAccepted` runs once the server accepts the start, so the caller can drop what the User
   * typed only then.
   */
  start: (
    range: CalendarRange,
    request: string,
    favoriteRecipeIds: readonly string[],
    onAccepted?: () => void
  ) => void;
  /**
   * Starts again with the range, request and favorites of the last start. After a generation that failed
   * the session is still active and holds the range, so it is cancelled first.
   */
  retry: () => void;
  /**
   * Confirms the ready proposal: its meals become the live plan and the Shopping list is rebuilt.
   * The cached calendar is read again once the session is committed.
   */
  confirm: () => void;
  /** Rejects the ready proposal and asks for another one with the range and request of the start. */
  reject: () => void;
  /**
   * Leaves the ready proposal, or the generation on its way, without committing anything: its
   * session is cancelled.
   */
  cancel: () => void;
  /** The action on its way, if any: one runs at a time. */
  pendingAction: PlanningAction | null;
  /** Why the last action was refused, while the proposal is still there to act on. */
  actionError: ApiError | null;
  /**
   * The last confirm of the ready proposal ended without an answer, so it may have committed on
   * the server. Until a new confirm reads the result, rejecting or cancelling could undo a menu
   * that is already scheduled: only confirming again is offered.
   */
  isConfirmUnresolved: boolean;
}

/**
 * The first proposal of the joined planning topic: what `start` pushes and the events that answer
 * it become the state of the draft. A payload that does not parse is logged and dropped, so a
 * server that drifts leaves the draft where it was instead of crashing the screen; a proposal that
 * does not parse fails its generation instead. `now` is the clock of the generation time limit.
 */
export function usePlanningDraft(
  topic: PlanningTopicState,
  now: () => number = Date.now
): PlanningDraftController {
  const [draft, dispatch] = useReducer(planningDraftReducer, IDLE_PLANNING_DRAFT);
  const subscription = topic.status === 'joined' ? topic.subscription : null;
  // The requests of the generations left behind before their session was known, by a cancel or by
  // a retry after a failed generation: each session is cancelled once `generation_started` names it.
  const abandonedRequestsRef = useRef(new Set<string>());

  useEffect(() => {
    if (subscription === null) return;

    const unsubscribers = DRAFT_EVENTS.map(({ event, toAction }) =>
      subscription.on(event, (payload) => {
        let action: PlanningDraftAction;
        try {
          action = toAction(payload);
        } catch (error) {
          console.warn(`[Planner] Ignored a malformed ${event}:`, error);
          return;
        }
        dispatch(action);

        if (
          action.type === 'generation_started' &&
          abandonedRequestsRef.current.delete(action.payload.requestId)
        ) {
          // A session that is already over answers an error, which changes nothing here: it is only
          // logged, since an error could also leave the abandoned session running.
          subscription.push('cancel_planning', { sessionId: action.payload.sessionId }).then(
            () => undefined,
            (error: unknown) =>
              console.warn('[Planner] Failed to cancel an abandoned generation:', error)
          );
        }
      })
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [subscription]);

  // The reducer decides when a generation has run out of time; this only wakes it at the deadline.
  const deadline = generationDeadline(draft);

  useEffect(() => {
    if (deadline === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      const current = now();
      dispatch({ type: 'clock_ticked', now: current });
      // Woken early, the draft does not move and this effect does not run again: wake once more.
      if (current < deadline) timer = setTimeout(wake, deadline - current);
    };
    timer = setTimeout(wake, Math.max(0, deadline - now()));
    return () => clearTimeout(timer);
  }, [deadline, now]);

  // What the last start asked for, so a retry sends the same thing under a new request id.
  const lastStartRef = useRef<{
    range: CalendarRange;
    request: string;
    favoriteRecipeIds: readonly string[];
  } | null>(null);

  const start = useCallback(
    (
      range: CalendarRange,
      request: string,
      favoriteRecipeIds: readonly string[],
      onAccepted?: () => void,
      sessionToCancel: string | null = null
    ) => {
      if (subscription === null) return;
      const requestId = newRequestId();
      const params = buildStartPlanningParams(range, request, requestId, favoriteRecipeIds);
      if (params === null) return;

      lastStartRef.current = { range, request, favoriteRecipeIds };
      dispatch({ type: 'start_requested', requestId, now: now() });

      // The server would refuse it as `invalid_payload`; say so without the round trip.
      if (isPlanningRequestTooLong(request)) {
        dispatch({
          type: 'start_rejected',
          requestId,
          error: new ApiError('invalid_payload', 'The request is too long'),
        });
        return;
      }

      const sendStart = () => subscription.push('start_planning', params);
      // A session that is already over answers an error, which changes nothing here.
      const sent =
        sessionToCancel === null
          ? sendStart()
          : subscription
              .push('cancel_planning', { sessionId: sessionToCancel })
              .then(
                () => undefined,
                () => undefined
              )
              .then(sendStart);

      sent.then(
        (reply) => {
          onAccepted?.();
          // The events carry the progress. A drifted reply is logged.
          try {
            parseStartPlanningReply(reply);
          } catch (error) {
            console.warn('[Planner] Malformed start_planning reply:', error);
          }
        },
        (error: unknown) => {
          // The server may be slow, not gone: the events still resolve the draft.
          if (isApiError(error) && error.code === 'timeout') return;
          // A refused start runs no generation, so a cancel of it has nothing left to wait for.
          abandonedRequestsRef.current.delete(requestId);
          dispatch({
            type: 'start_rejected',
            requestId,
            error: isApiError(error) ? error : new ApiError('unknown_error', 'Request failed'),
          });
        }
      );
    },
    [subscription, now]
  );

  const retry = useCallback(() => {
    const last = lastStartRef.current;
    if (last === null) return;
    const failedGeneration =
      draft.status === 'failed' && draft.failure.kind === 'generation' ? draft : null;
    // A generation that failed before its session was known, by the time limit or an unreadable
    // proposal, may still be running: its session is cancelled once known.
    if (failedGeneration !== null && failedGeneration.sessionId === null) {
      abandonedRequestsRef.current.add(failedGeneration.requestId);
    }
    const sessionToCancel = failedGeneration?.sessionId ?? null;
    start(last.range, last.request, last.favoriteRecipeIds, undefined, sessionToCancel);
  }, [draft, start]);

  const [pendingAction, setPendingAction] = useState<PlanningAction | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  // A ref next to the state: two presses can land before the first one has re-rendered anything.
  const isActingRef = useRef(false);

  const runAction = useCallback(async (action: PlanningAction, work: () => Promise<void>) => {
    if (isActingRef.current) return;
    isActingRef.current = true;
    setPendingAction(action);
    setActionError(null);

    try {
      await work();
    } catch (error) {
      setActionError(isApiError(error) ? error : new ApiError('unknown_error', 'Request failed'));
    } finally {
      isActingRef.current = false;
      setPendingAction(null);
    }
  }, []);

  // Cancels a session; one that is already over answers an error, which changes nothing here.
  const cancelSession = useCallback(
    (sessionId: string) =>
      subscription === null
        ? Promise.resolve()
        : subscription.push('cancel_planning', { sessionId }).then(
            () => undefined,
            () => undefined
          ),
    [subscription]
  );

  const ready = draft.status === 'ready' ? draft : null;
  // The proposal whose last confirm got no answer.
  const [unresolvedProposalId, setUnresolvedProposalId] = useState<string | null>(null);
  const isConfirmUnresolved = ready !== null && ready.proposal.proposalId === unresolvedProposalId;

  const confirm = useCallback(() => {
    if (ready === null || ready.sessionId === null) return;
    const { sessionId } = ready;
    const { proposalId } = ready.proposal;

    void runAction('confirm', async () => {
      let reply;
      try {
        reply = await confirmProposal({ proposalId, sessionId });
      } catch (error) {
        const unanswered = !isApiError(error) || UNANSWERED_CODES.includes(error.code);
        setUnresolvedProposalId(unanswered ? proposalId : null);
        throw error;
      }
      setUnresolvedProposalId(null);
      dispatch({
        type: 'session_committed',
        payload: {
          sessionId: reply.sessionId,
          proposalId: reply.proposalId,
          scheduledMealsCount: reply.scheduledMealsCount,
          shoppingRebuilt: reply.shoppingRebuilt,
        },
      });
    });
  }, [ready, runAction]);

  const reject = useCallback(() => {
    if (ready === null || isConfirmUnresolved) return;
    const { sessionId } = ready;
    const { proposalId } = ready.proposal;

    void runAction('reject', async () => {
      await rejectProposal(proposalId);
      const last = lastStartRef.current;
      // The session still holds the range, so the next start cancels it first.
      if (last !== null) {
        start(last.range, last.request, last.favoriteRecipeIds, undefined, sessionId);
      } else {
        if (sessionId !== null) await cancelSession(sessionId);
        dispatch({ type: 'reset' });
      }
    });
  }, [ready, isConfirmUnresolved, runAction, start, cancelSession]);

  const generating = draft.status === 'generating' ? draft : null;

  const cancel = useCallback(() => {
    // A generation is left at once: whatever it still answers no longer moves the draft.
    if (generating !== null) {
      dispatch({ type: 'reset' });
      if (generating.sessionId === null) abandonedRequestsRef.current.add(generating.requestId);
      else void cancelSession(generating.sessionId);
      return;
    }
    if (ready === null || isConfirmUnresolved) return;
    const { sessionId } = ready;

    void runAction('cancel', async () => {
      if (sessionId !== null) await cancelSession(sessionId);
      dispatch({ type: 'reset' });
    });
  }, [generating, ready, isConfirmUnresolved, runAction, cancelSession]);

  // The committed proposal is the live plan now: the cached calendar is read again. A read that
  // fails leaves the cache as it was, and the next one of the app heals it.
  const committedSessionId = draft.status === 'committed' ? draft.sessionId : null;

  useEffect(() => {
    if (committedSessionId === null) return;
    loadLivePlan().catch(() => undefined);
  }, [committedSessionId]);

  return {
    draft,
    start,
    retry,
    confirm,
    reject,
    cancel,
    pendingAction,
    actionError,
    isConfirmUnresolved,
  };
}
