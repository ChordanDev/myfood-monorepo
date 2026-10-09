import { useCallback, useRef, useState } from 'react';
import { getAuthErrorMessage } from '@/api/errors';
import { useMealPlanStore } from '@/store';
import { finishCookingSession, startCookingSession } from '../api';
import { summarizeCookingFinish, type CookingSummary } from '../domain';

/**
 * Marks a planned meal as cooked through the server: a Cooking session starts and finishes, and
 * the answer says what was consumed and what the stock could not cover. The local plan entry is
 * marked only once the server confirmed, so a refusal leaves the meal as it was.
 */
export function useMarkAsCooked() {
  const markEntryCooked = useMealPlanStore((state) => state.markAsCooked);
  const [isPending, setIsPending] = useState(false);
  const [summary, setSummary] = useState<CookingSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // State lags a render behind: the ref is what stops a second tap from starting a second session.
  const inFlightRef = useRef(false);

  const markAsCooked = useCallback(
    async (entryId: string): Promise<boolean> => {
      if (inFlightRef.current) return false;

      inFlightRef.current = true;
      setIsPending(true);
      setErrorMessage(null);

      try {
        const session = await startCookingSession(entryId);
        const finish = await finishCookingSession(session.sessionId);

        markEntryCooked(entryId);
        setSummary(summarizeCookingFinish(finish));
        return true;
      } catch (error) {
        setErrorMessage(getAuthErrorMessage(error));
        return false;
      } finally {
        inFlightRef.current = false;
        setIsPending(false);
      }
    },
    [markEntryCooked]
  );

  const dismiss = useCallback(() => {
    setSummary(null);
    setErrorMessage(null);
  }, []);

  return { markAsCooked, isPending, summary, errorMessage, dismiss };
}
