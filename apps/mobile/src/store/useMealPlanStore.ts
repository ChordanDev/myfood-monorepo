import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MealPlanEntry, MasterRecipe } from '../types/domain';
import { MOCK_MEAL_PLAN, MOCK_MASTER_RECIPES } from '../mocks/domainMocks';
import { useInventoryStore } from '@/features/inventory/store';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';

interface EatTodayParams {
  sourceDate: string;
  sourceType: MealPlanEntry['type'];
  targetDate: string;
  targetType: MealPlanEntry['type'];
}

interface MealPlanState {
  entries: MealPlanEntry[];
  recipes: MasterRecipe[];
  setPlan: (entries: MealPlanEntry[]) => void;
  markAsCooked: (entryId: string) => void;
  markAsSkipped: (entryId: string) => void;
  eatToday: (params: EatTodayParams) => void;
  getEntryByDateAndType: (date: string, type: string) => MealPlanEntry | undefined;
  getRecipeById: (id: string) => MasterRecipe | undefined;
}

// Runs when the stored version is another one. A plan stored before version 2 has entries
// that no longer match the fixtures, so only its entries are replaced by the fixture plan:
// the rest of what the User stored is kept.
function migrateMealPlanState(persistedState: unknown, version: number): MealPlanState {
  const stored = (
    typeof persistedState === 'object' && persistedState !== null ? persistedState : {}
  ) as MealPlanState;

  return version < 2 ? { ...stored, entries: MOCK_MEAL_PLAN } : stored;
}

export const useMealPlanStore = create<MealPlanState>()(
  persist(
    (set, get) => ({
      entries: MOCK_MEAL_PLAN,
      recipes: MOCK_MASTER_RECIPES,
      setPlan: (entries) => set({ entries }),
      markAsCooked: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.isCooked || entry.isSkipped) return;

        const recipe = get().recipes.find((r) => r.id === entry.recipeId);
        if (recipe) {
          // Consumo automático de ingredientes
          const inventoryStore = useInventoryStore.getState();
          recipe.ingredients.forEach((ing) => {
            inventoryStore.consumeIngredient(ing.ingredientId, ing.amount);
          });
        }

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
      eatToday: ({ sourceDate, sourceType, targetDate, targetType }) => {
        set((state) => {
          const sourceEntry = state.entries.find(
            (entry) => entry.date === sourceDate && entry.type === sourceType
          );

          if (!sourceEntry || sourceEntry.isCooked) {
            return state;
          }

          const targetEntry = state.entries.find(
            (entry) => entry.date === targetDate && entry.type === targetType
          );

          if (targetEntry?.isCooked) {
            return state;
          }

          return {
            entries: state.entries.map((entry) => {
              if (entry.id === sourceEntry.id) {
                return { ...entry, date: targetDate, type: targetType };
              }

              if (targetEntry && entry.id === targetEntry.id) {
                return { ...entry, date: sourceDate, type: sourceType };
              }

              return entry;
            }),
          };
        });
      },
      getEntryByDateAndType: (date, type) => {
        return get().entries.find((e) => e.date === date && e.type === type);
      },
      getRecipeById: (id) => {
        return get().recipes.find((r) => r.id === id);
      },
    }),
    {
      name: 'meal-plan-storage',
      // Bumped whenever the stored entries stop matching the fixtures; `migrate` then swaps
      // them for the fixture plan. Version 2: meal slots became the API codes.
      version: 2,
      migrate: migrateMealPlanState,
      storage: createJSONStorage(() => safeAsyncStorage),
    }
  )
);
