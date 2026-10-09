import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiError, isApiError } from '@/api/errors';
import { newRequestId } from '@/api/requestId';
import type { CalendarRange } from '@/features/home';
import {
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
  {
    event: 'proposal_ready',
    toAction: (payload) => ({ type: 'proposal_ready', payload: parseProposalReady(payload) }),
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
];

export interface PlanningDraftController {
  draft: PlanningDraft;
  /**
   * Starts planning `range` with the optional free-text `request`. Does nothing while the topic
   * is not joined or no day is picked. `onAccepted` runs once the server accepts the start, so
   * the caller can drop what the User typed only then.
   */
  start: (range: CalendarRange, request: string, onAccepted?: () => void) => void;
  /**
   * Starts again with the range and request of the last start. After a generation that failed
   * the session is still active and holds the range, so it is cancelled first.
   */
  retry: () => void;
}

/**
 * The first proposal of the joined planning topic: what `start` pushes and the events that answer
 * it become the state of the draft. A payload that does not parse is logged and dropped, so a
 * server that drifts leaves the draft where it was instead of crashing the screen.
 */
export function usePlanningDraft(topic: PlanningTopicState): PlanningDraftController {
  const [draft, dispatch] = useReducer(planningDraftReducer, IDLE_PLANNING_DRAFT);
  const subscription = topic.status === 'joined' ? topic.subscription : null;

  useEffect(() => {
    if (subscription === null) return;

    const unsubscribers = DRAFT_EVENTS.map(({ event, toAction }) =>
      subscription.on(event, (payload) => {
        try {
          dispatch(toAction(payload));
        } catch (error) {
          console.warn(`[Planner] Ignored a malformed ${event}:`, error);
        }
      })
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [subscription]);

  // What the last start asked for, so a retry sends the same thing under a new request id.
  const lastStartRef = useRef<{ range: CalendarRange; request: string } | null>(null);

  const start = useCallback(
    (
      range: CalendarRange,
      request: string,
      onAccepted?: () => void,
      sessionToCancel: string | null = null
    ) => {
      if (subscription === null) return;
      const requestId = newRequestId();
      const params = buildStartPlanningParams(range, request, requestId);
      if (params === null) return;

      lastStartRef.current = { range, request };
      dispatch({ type: 'start_requested', requestId });

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
          dispatch({
            type: 'start_rejected',
            requestId,
            error: isApiError(error) ? error : new ApiError('unknown_error', 'Request failed'),
          });
        }
      );
    },
    [subscription]
  );

  const retry = useCallback(() => {
    const last = lastStartRef.current;
    if (last === null) return;
    const sessionToCancel =
      draft.status === 'failed' && draft.failure.kind === 'generation' ? draft.sessionId : null;
    start(last.range, last.request, undefined, sessionToCancel);
  }, [draft, start]);

  return { draft, start, retry };
}
