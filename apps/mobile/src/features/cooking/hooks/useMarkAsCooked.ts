import { useCallback, useRef, useState } from 'react';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { useMealPlanStore } from '@/store';
import { finishCookingSession, startCookingSession } from '../api';
import { summarizeCookingFinish, type CookingSummary } from '../domain';

/**
 * Marks a planned meal as cooked through the server: a Cooking session starts and finishes, and
 * the answer says what was consumed and what the stock could not cover. The local plan entry is
 * marked only once the server confirmed, so a refusal leaves the meal as it was.
 *
 * Closing the result of a finish that succeeded is when the app asks about leftovers:
 * `leftoverPrompt` then holds that finish until the prompt is closed.
 *
 * `cooking_already_finished` is a success: the meal is cooked already, typically by a finish
 * whose answer was lost before a retry. The server does not consume again and its answer holds
 * no summary to rebuild, so the meal is marked cooked and the result only says it was cooked
 * already; closing it asks nothing about leftovers.
 */
export function useMarkAsCooked() {
  const markEntryCooked = useMealPlanStore((state) => state.markAsCooked);
  const [isPending, setIsPending] = useState(false);
  const [summary, setSummary] = useState<CookingSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [leftoverPrompt, setLeftoverPrompt] = useState<CookingSummary | null>(null);
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
        const message = getAuthErrorMessage(error);

        if (isApiError(error) && error.code === 'cooking_already_finished') {
          markEntryCooked(entryId);
          setErrorMessage(message);
          return true;
        }

        setErrorMessage(message);
        return false;
      } finally {
        inFlightRef.current = false;
        setIsPending(false);
      }
    },
    [markEntryCooked]
  );

  const dismiss = useCallback(() => {
    // A refusal has no summary, so it asks nothing; a second dismiss finds none either.
    if (summary) setLeftoverPrompt(summary);
    setSummary(null);
    setErrorMessage(null);
  }, [summary]);

  const closeLeftoverPrompt = useCallback(() => setLeftoverPrompt(null), []);

  return {
    markAsCooked,
    isPending,
    summary,
    errorMessage,
    dismiss,
    leftoverPrompt,
    closeLeftoverPrompt,
  };
}
