import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuthErrorMessage } from '@/api/errors';
import { newRequestId } from '@/services/requestId';
import {
  consumePreparedLeftover,
  createPreparedLeftover,
  discardPreparedLeftover,
  listPreparedLeftovers,
} from '../api/leftoversApi';
import type { CreatePreparedLeftoverInput, PreparedLeftover } from '../types';

type LeftoversStatus = 'loading' | 'ready';

// The open leftovers as the server has them. Every action asks the server and then reads the
// list again, so the screen never guesses what an action did.
export function usePreparedLeftovers() {
  const [leftovers, setLeftovers] = useState<PreparedLeftover[]>([]);
  const [status, setStatus] = useState<LeftoversStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestCounter = useRef(0);
  // Per leftover, the last "Eat" that may not have landed and the portions it showed. Eating
  // the same leftover at the same portions again is the same intent, so it keeps the same
  // actionId and the server eats once. Once the list shows fewer portions, a tap is a new one.
  // Kept per leftover so a tap on another one in between does not forget it.
  const pendingConsumesRef = useRef(new Map<string, { key: string; actionId: string }>());

  const load = useCallback(async () => {
    const requestId = ++requestCounter.current;

    try {
      const next = await listPreparedLeftovers();
      if (requestId !== requestCounter.current) return;
      setLeftovers(next);
      setErrorMessage(null);
    } catch (error) {
      if (requestId !== requestCounter.current) return;
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      if (requestId === requestCounter.current) setStatus('ready');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const act = useCallback(
    async (id: string, action: (id: string) => Promise<PreparedLeftover>) => {
      setBusyId(id);
      let failure: string | null = null;
      try {
        await action(id);
      } catch (error) {
        failure = getAuthErrorMessage(error);
      }
      await load();
      // The list is read again either way; a failed action stays on screen after that read.
      if (failure !== null) setErrorMessage(failure);
      setBusyId(null);
    },
    [load]
  );

  const consume = useCallback(
    (id: string) => {
      const portions = leftovers.find((leftover) => leftover.id === id)?.portions;
      const key = `${id}:${portions}`;
      const pending = pendingConsumesRef.current;
      let intent = pending.get(id);
      if (intent?.key !== key) {
        intent = { key, actionId: newRequestId() };
        pending.set(id, intent);
      }
      const { actionId } = intent;

      return act(id, async (leftoverId) => {
        const eaten = await consumePreparedLeftover(leftoverId, actionId);
        pending.delete(leftoverId);
        return eaten;
      });
    },
    [act, leftovers]
  );
  const discard = useCallback((id: string) => act(id, discardPreparedLeftover), [act]);

  // Online only: it throws what the server answered, for the sheet to show, and reads the
  // list again once the leftover is stored.
  const add = useCallback(
    async (input: CreatePreparedLeftoverInput) => {
      await createPreparedLeftover(input);
      await load();
    },
    [load]
  );

  return {
    leftovers,
    isLoading: status === 'loading',
    isEmpty: status === 'ready' && leftovers.length === 0 && errorMessage === null,
    errorMessage,
    busyId,
    consume,
    discard,
    add,
    retry: () => void load(),
  };
}
