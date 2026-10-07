/**
 * Temporary narrow port for "add this to the shopping list". The shopping list feature
 * (issue #44) will replace this store behind the same call sites.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { UnitType } from '@/types/domain';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';

export type ShoppingRequest = {
  id: string;
  name: string;
  ingredientId?: string;
  amount?: number;
  unit?: UnitType;
  createdAt: string;
};

export type ShoppingRequestInput = {
  name: string;
  ingredientId?: string;
  amount?: number;
  unit?: UnitType;
};

interface ShoppingRequestsState {
  requests: ShoppingRequest[];
  /** Adds a request, or folds it into the one already made for the same ingredient or name. */
  requestIngredient: (input: ShoppingRequestInput) => void;
  removeRequest: (id: string) => void;
  clearRequests: () => void;
}

/** Disambiguates requests created within the same millisecond. */
let requestSequence = 0;

function createRequest(input: ShoppingRequestInput): ShoppingRequest {
  const now = new Date();
  requestSequence += 1;

  return {
    ...input,
    id: `request-${now.getTime()}-${requestSequence}`,
    createdAt: now.toISOString(),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A catalog ingredient is the same request as another one for that ingredient. A free-text
 * request only matches another free-text request with the same name.
 */
function isSameRequest(request: ShoppingRequest, input: ShoppingRequestInput): boolean {
  if (input.ingredientId !== undefined) return request.ingredientId === input.ingredientId;

  return (
    request.ingredientId === undefined && normalizeName(request.name) === normalizeName(input.name)
  );
}

/** Keeps the existing request and raises its amount when the new one asks for more. */
function mergeRequest(request: ShoppingRequest, input: ShoppingRequestInput): ShoppingRequest {
  const asksForMore =
    input.amount !== undefined && (request.amount === undefined || input.amount > request.amount);
  if (!asksForMore) return request;

  return { ...request, amount: input.amount, unit: input.unit ?? request.unit };
}

export const useShoppingRequestsStore = create<ShoppingRequestsState>()(
  persist(
    (set) => ({
      requests: [],
      requestIngredient: (rawInput) => {
        const input = { ...rawInput, name: rawInput.name.trim() };
        if (input.ingredientId === undefined && input.name === '') return;

        set((state) => {
          const isDuplicate = state.requests.some((request) => isSameRequest(request, input));

          return {
            requests: isDuplicate
              ? state.requests.map((request) =>
                  isSameRequest(request, input) ? mergeRequest(request, input) : request
                )
              : [...state.requests, createRequest(input)],
          };
        });
      },
      removeRequest: (id) => {
        set((state) => ({ requests: state.requests.filter((request) => request.id !== id) }));
      },
      clearRequests: () => set({ requests: [] }),
    }),
    {
      name: 'shopping-requests-storage',
      storage: createJSONStorage(() => safeAsyncStorage),
    }
  )
);

/**
 * Catalog ids that already have a request. Returns a new array on every call: wrap it with
 * `useShallow` when it is used as a store hook selector.
 */
export function selectRequestedIngredientIds(
  state: Pick<ShoppingRequestsState, 'requests'>
): string[] {
  return state.requests.flatMap((request) =>
    request.ingredientId === undefined ? [] : [request.ingredientId]
  );
}
