import { useEffect, useState } from 'react';
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
}

/**
 * Searches the Ingredient catalogue by name once typing pauses. Only the answer of the current
 * query is shown: an earlier one that comes back later is dropped. A blank query searches nothing.
 */
export function useIngredientSearch(query: string): IngredientSearch {
  const trimmed = query.trim().slice(0, INGREDIENT_QUERY_MAX_LENGTH);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (trimmed.length === 0) return;

    let isCurrent = true;
    const timer = setTimeout(() => {
      searchIngredients(trimmed).then(
        (results) => {
          if (isCurrent) setAnswer({ query: trimmed, status: 'done', results });
        },
        () => {
          if (isCurrent) setAnswer({ query: trimmed, status: 'error', results: [] });
        }
      );
    }, SEARCH_DELAY_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  if (trimmed.length === 0) return IDLE;
  if (answer?.query !== trimmed) return SEARCHING;

  return { status: answer.status, results: answer.results };
}
