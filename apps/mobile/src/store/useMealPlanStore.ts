import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MealPlanEntry, MasterRecipe, RecipeSummary } from '../types/domain';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { registerAccountDataReset } from '@/features/auth/utils/accountDataReset';

interface MealPlanState {
  entries: MealPlanEntry[];
  recipes: MasterRecipe[];
  recipeSummaries: Record<string, RecipeSummary>;
  setPlan: (entries: MealPlanEntry[]) => void;
  setRecipeSummaries: (recipeSummaries: Record<string, RecipeSummary>) => void;
  markAsCooked: (entryId: string) => void;
  markAsSkipped: (entryId: string) => void;
  /** Drops everything cached for the signed-in account (plan and summaries). */
  resetAccountData: () => void;
  getEntryByDateAndType: (date: string, type: string) => MealPlanEntry | undefined;
  getRecipeById: (id: string) => MasterRecipe | undefined;
}

// Runs when the stored version is another one. A plan stored before version 3 was seeded from
// the fixtures, so it is dropped: the calendar read fills the cache again. The rest of what the
// User stored is kept.
function migrateMealPlanState(persistedState: unknown, version: number): MealPlanState {
  const stored = (
    typeof persistedState === 'object' && persistedState !== null ? persistedState : {}
  ) as MealPlanState;

  return version < 3 ? { ...stored, entries: [], recipeSummaries: {} } : stored;
}

export const useMealPlanStore = create<MealPlanState>()(
  persist(
    (set, get) => ({
      entries: [],
      recipes: [],
      recipeSummaries: {},
      setPlan: (entries) => set({ entries }),
      setRecipeSummaries: (recipeSummaries) => set({ recipeSummaries }),
      // Only the local mark: the stock is consumed by the server's Cooking session, whose
      // summary the user sees, so the plan does not subtract anything from the inventory.
      markAsCooked: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.isCooked || entry.isSkipped) return;

        set((state) => ({
          entries: state.entries.map((e) => (e.id === entryId ? { ...e, isCooked: true } : e)),
        }));
      },
      markAsSkipped: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.isCooked || entry.isSkipped) return;

        set((state) => ({
          entries: state.entries.map((e) => (e.id === entryId ? { ...e, isSkipped: true } : e)),
        }));
      },
      resetAccountData: () => set({ entries: [], recipeSummaries: {} }),
      getEntryByDateAndType: (date, type) => {
        return get().entries.find((e) => e.date === date && e.type === type);
      },
      getRecipeById: (id) => {
        return get().recipes.find((r) => r.id === id);
      },
    }),
    {
      name: 'meal-plan-storage',
      // Bumped whenever the stored plan stops matching what the calendar read serves; `migrate`
      // then empties it. Version 3: the plan is a cache of `GET /api/calendar`, not fixtures.
      version: 3,
      migrate: migrateMealPlanState,
      storage: createJSONStorage(() => safeAsyncStorage),
    }
  )
);

registerAccountDataReset(() => useMealPlanStore.getState().resetAccountData());
