import { useEffect, useState } from 'react';
import type { ApiError } from '@/api/errors';
import { getSocketClient, planningTopic, type TopicSubscription } from '@/api/socket';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  SESSION_MOVED_ON_EVENTS,
  SESSION_OVER_EVENTS,
  type SessionOverReason,
  type SessionResumedPayload,
} from '../types/planningSession';

/**
 * `idle` while there is no Account to join for. A joined topic hands out its subscription, to
 * push commands and listen to events for as long as the caller is mounted.
 */
export type PlanningTopicState =
  | { status: 'idle' }
  | { status: 'joining' }
  | {
      status: 'joined';
      /** To push commands and listen to events on the topic; left when the caller unmounts. */
      subscription: TopicSubscription;
      /** The session the server resumed after the join; absent when there is none. */
      resumed?: SessionResumedPayload;
      /** Why the session ended; absent while it has not. */
      sessionOver?: SessionOverReason;
    }
  | { status: 'refused'; error: ApiError };

type JoinAnswer =
  | { status: 'joined'; subscription: TopicSubscription }
  | { status: 'refused'; error: ApiError };

/** What the topic pushed about the session since the join, until the next push replaces it. */
type SessionEvents = { resumed?: SessionResumedPayload; sessionOver?: SessionOverReason };

function isSessionResumed(payload: unknown): payload is SessionResumedPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { sessionId?: unknown }).sessionId === 'string'
  );
}

const IDLE: PlanningTopicState = { status: 'idle' };
const JOINING: PlanningTopicState = { status: 'joining' };

/**
 * Keeps the planning topic of the signed-in Account joined while the caller is mounted, and
 * tells how the join went. It asks the app socket to stay connected and never closes it: the
 * socket belongs to the whole app. The socket follows the session on its own, so the topic stays
 * `joining` while there is no session and joins once one arrives; a refused topic is not retried.
 */
export function usePlanningTopic(): PlanningTopicState {
  const { me } = useAuth();
  const accountId = me?.account.id ?? null;
  // What the server answered to the join of `answeredAccountId`; null until it answers.
  const [answer, setAnswer] = useState<JoinAnswer | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEvents>({});
  const [answeredAccountId, setAnsweredAccountId] = useState(accountId);

  // An answer holds for one Account's topic only. It is dropped while rendering, so the screen
  // never shows the answer of the previous topic.
  if (answeredAccountId !== accountId) {
    setAnsweredAccountId(accountId);
    setAnswer(null);
    setSessionEvents({});
  }

  useEffect(() => {
    if (accountId === null) return;

    // A reply can still arrive once the cleanup has left the topic.
    let isCurrent = true;
    const client = getSocketClient();
    // connect() never rejects, and one call is enough: the client then opens the socket
    // whenever a session exists.
    void client.connect();
    const subscription = client.joinTopic(planningTopic(accountId), {
      onJoined: () => {
        if (isCurrent) setAnswer({ status: 'joined', subscription });
      },
      onRefused: (error) => {
        if (isCurrent) setAnswer({ status: 'refused', error });
      },
      events: {
        // The server pushes it after a join only when the Account has an active session.
        session_resumed: (payload) => {
          if (isCurrent && isSessionResumed(payload)) setSessionEvents({ resumed: payload });
        },
        ...Object.fromEntries(
          SESSION_OVER_EVENTS.map((reason) => [
            reason,
            () => {
              if (isCurrent) setSessionEvents({ sessionOver: reason });
            },
          ])
        ),
        ...Object.fromEntries(
          SESSION_MOVED_ON_EVENTS.map((event) => [
            event,
            () => {
              if (isCurrent) setSessionEvents({});
            },
          ])
        ),
      },
    });

    return () => {
      isCurrent = false;
      subscription.leave();
    };
  }, [accountId]);

  if (accountId === null) return IDLE;
  if (answer?.status === 'refused') return answer;
  if (answer === null) return JOINING;
  return { ...answer, ...sessionEvents };
}
