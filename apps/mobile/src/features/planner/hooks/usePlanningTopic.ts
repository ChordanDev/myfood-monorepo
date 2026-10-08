import { useEffect, useState } from 'react';
import type { ApiError } from '@/api/errors';
import { getSocketClient, planningTopic } from '@/api/socket';
import { useAuth } from '@/features/auth/hooks/useAuth';

/** `idle` while there is no Account to join for. */
export type PlanningTopicState =
  | { status: 'idle' }
  | { status: 'joining' }
  | { status: 'joined' }
  | { status: 'refused'; error: ApiError };

type JoinAnswer = Extract<PlanningTopicState, { status: 'joined' | 'refused' }>;

const IDLE: PlanningTopicState = { status: 'idle' };
const JOINING: PlanningTopicState = { status: 'joining' };
const JOINED: JoinAnswer = { status: 'joined' };

/**
 * Keeps the planning topic of the signed-in Account joined while the caller is mounted, and
 * tells how the join went. It opens the app socket when needed and never closes it: the socket
 * belongs to the whole app.
 */
export function usePlanningTopic(): PlanningTopicState {
  const { me } = useAuth();
  const accountId = me?.account.id ?? null;
  // What the server answered to the join of `answeredAccountId`; null until it answers.
  const [answer, setAnswer] = useState<JoinAnswer | null>(null);
  const [answeredAccountId, setAnsweredAccountId] = useState(accountId);

  // An answer holds for one Account's topic only. It is dropped while rendering, so the screen
  // never shows the answer of the previous topic.
  if (answeredAccountId !== accountId) {
    setAnsweredAccountId(accountId);
    setAnswer(null);
  }

  useEffect(() => {
    if (accountId === null) return;

    // A reply can still arrive once the cleanup has left the topic.
    let isCurrent = true;
    const client = getSocketClient();
    void client.connect();
    const subscription = client.joinTopic(planningTopic(accountId), {
      onJoined: () => {
        if (isCurrent) setAnswer(JOINED);
      },
      onRefused: (error) => {
        if (isCurrent) setAnswer({ status: 'refused', error });
      },
    });

    return () => {
      isCurrent = false;
      subscription.leave();
    };
  }, [accountId]);

  if (accountId === null) return IDLE;
  return answer ?? JOINING;
}
