import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MealPlanEntry, RecipeSummary } from '../types/domain';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { registerAccountDataReset } from '@/features/auth/utils/accountDataReset';

interface MealPlanState {
  entries: MealPlanEntry[];
  recipeSummaries: Record<string, RecipeSummary>;
  /**
   * The Account's today as the last calendar read served it (`YYYY-MM-DD`), `null` before one.
   * It tells a past meal from today's; the device's date can be another day.
   */
  today: string | null;
  setPlan: (entries: MealPlanEntry[]) => void;
  setRecipeSummaries: (recipeSummaries: Record<string, RecipeSummary>) => void;
  setToday: (today: string) => void;
  markAsCooked: (entryId: string) => void;
  /** Applies a "not cooked" answer the server already stored: the meal is a Skipped meal. */
  applyNotCookedAnswer: (entryId: string) => void;
  /** Drops everything cached for the signed-in account (plan, summaries and its today). */
  resetAccountData: () => void;
  getEntryByDateAndType: (date: string, type: string) => MealPlanEntry | undefined;
}

// Runs when the stored version is another one. A plan stored before version 3 was seeded from
// the fixtures, so it is dropped with the fixture `recipes` that came with it, a key the store no
// longer has: the calendar read fills the cache again. The rest of what the User stored is kept.
function migrateMealPlanState(persistedState: unknown, version: number): MealPlanState {
  const stored = (
    typeof persistedState === 'object' && persistedState !== null ? persistedState : {}
  ) as MealPlanState & { recipes?: unknown };

  if (version >= 3) return stored;
  const { recipes: _fixtureRecipes, ...rest } = stored;
  return { ...rest, entries: [], recipeSummaries: {} };
}

export const useMealPlanStore = create<MealPlanState>()(
  persist(
    (set, get) => ({
      entries: [],
      recipeSummaries: {},
      today: null,
      setPlan: (entries) => set({ entries }),
      setRecipeSummaries: (recipeSummaries) => set({ recipeSummaries }),
      setToday: (today) => set({ today }),
      // Only the local mark: the stock is consumed by the server's Cooking session, whose
      // summary the user sees, so the plan does not subtract anything from the inventory.
      markAsCooked: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.isCooked || entry.isSkipped) return;

        set((state) => ({
          entries: state.entries.map((e) => (e.id === entryId ? { ...e, isCooked: true } : e)),
        }));
      },
      // Never the answer itself: `POST /api/calendar/meals/:id/confirm` stores it, and the next
      // calendar read serves it as `isSkipped` on every device.
      applyNotCookedAnswer: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.isCooked || entry.isSkipped) return;

        set((state) => ({
          entries: state.entries.map((e) => (e.id === entryId ? { ...e, isSkipped: true } : e)),
        }));
      },
      resetAccountData: () => set({ entries: [], recipeSummaries: {}, today: null }),
      getEntryByDateAndType: (date, type) => {
        return get().entries.find((e) => e.date === date && e.type === type);
      },
    }),
    {
      name: 'meal-plan-storage',
      // Bumped whenever the stored plan stops matching what the calendar read serves; `migrate`
      // then empties it. Version 3: the plan is a cache of `GET /api/calendar`, not fixtures.
      version: 3,
      migrate: migrateMealPlanState,
      // The Account's today is not kept: on the next launch it may be another day, and the
      // calendar read brings it again.
      partialize: ({ today: _today, ...rest }) => rest,
      storage: createJSONStorage(() => safeAsyncStorage),
    }
  )
);

registerAccountDataReset(() => useMealPlanStore.getState().resetAccountData());
