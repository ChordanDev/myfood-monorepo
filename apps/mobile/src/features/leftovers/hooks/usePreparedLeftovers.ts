import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuthErrorMessage } from '@/api/errors';
import {
  consumePreparedLeftover,
  discardPreparedLeftover,
  listPreparedLeftovers,
} from '../api/leftoversApi';
import type { PreparedLeftover } from '../types';

type LeftoversStatus = 'loading' | 'ready';

// The open leftovers as the server has them. Every action asks the server and then reads the
// list again, so the screen never guesses what an action did.
export function usePreparedLeftovers() {
  const [leftovers, setLeftovers] = useState<PreparedLeftover[]>([]);
  const [status, setStatus] = useState<LeftoversStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestCounter = useRef(0);

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

  const consume = useCallback((id: string) => act(id, consumePreparedLeftover), [act]);
  const discard = useCallback((id: string) => act(id, discardPreparedLeftover), [act]);

  return {
    leftovers,
    isLoading: status === 'loading',
    isEmpty: status === 'ready' && leftovers.length === 0 && errorMessage === null,
    errorMessage,
    busyId,
    consume,
    discard,
    retry: () => void load(),
  };
}
