import { useCallback, useEffect, useState } from 'react';
import { searchIngredients } from '../api';
import type { IngredientOption } from '../types';

// How long typing has to pause before the catalogue is searched.
const SEARCH_DELAY_MS = 300;
// The longest query the catalogue search takes.
export const INGREDIENT_QUERY_MAX_LENGTH = 100;

export type IngredientSearchStatus = 'idle' | 'searching' | 'done' | 'error';

export interface IngredientSearch {
  status: IngredientSearchStatus;
  results: IngredientOption[];
}

const IDLE: IngredientSearch = { status: 'idle', results: [] };
const SEARCHING: IngredientSearch = { status: 'searching', results: [] };

interface Answer extends IngredientSearch {
  query: string;
  attempt: number;
}

/**
 * Searches the Ingredient catalogue by name once typing pauses. Only the answer of the current
 * query is shown: an earlier one that comes back later is dropped. A blank query searches nothing.
 * `retry` searches the same query again at once, after a failed search.
 */
export function useIngredientSearch(query: string): IngredientSearch & { retry: () => void } {
  const trimmed = query.trim().slice(0, INGREDIENT_QUERY_MAX_LENGTH);
  const [answer, setAnswer] = useState<Answer | null>(null);
  // How many times the user asked to search this query again. Another query starts at zero.
  const [retries, setRetries] = useState({ query: '', count: 0 });
  const attempt = retries.query === trimmed ? retries.count : 0;

  useEffect(() => {
    if (trimmed.length === 0) return;

    let isCurrent = true;
    // A retry was asked for: there is no typing to wait for.
    const delay = attempt > 0 ? 0 : SEARCH_DELAY_MS;
    const timer = setTimeout(() => {
      searchIngredients(trimmed).then(
        (results) => {
          if (isCurrent) setAnswer({ query: trimmed, attempt, status: 'done', results });
        },
        () => {
          if (isCurrent) setAnswer({ query: trimmed, attempt, status: 'error', results: [] });
        }
      );
    }, delay);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [trimmed, attempt]);

  const retry = useCallback(
    () => setRetries({ query: trimmed, count: attempt + 1 }),
    [trimmed, attempt]
  );

  if (trimmed.length === 0) return { ...IDLE, retry };
  if (answer?.query !== trimmed || answer.attempt !== attempt) return { ...SEARCHING, retry };

  return { status: answer.status, results: answer.results, retry };
}
