import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MealPlanEntry, MasterRecipe } from '../types/domain';
import { MOCK_MEAL_PLAN, MOCK_MASTER_RECIPES } from '../mocks/domainMocks';
import { useInventoryStore } from './useInventoryStore';

interface MealPlanState {
  entries: MealPlanEntry[];
  recipes: MasterRecipe[];
  setPlan: (entries: MealPlanEntry[]) => void;
  markAsCooked: (entryId: string) => void;
  getEntryByDateAndType: (date: string, type: string) => MealPlanEntry | undefined;
  getRecipeById: (id: string) => MasterRecipe | undefined;
}

export const useMealPlanStore = create<MealPlanState>()(
  persist(
    (set, get) => ({
      entries: MOCK_MEAL_PLAN,
      recipes: MOCK_MASTER_RECIPES,
      setPlan: (entries) => set({ entries }),
      markAsCooked: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.isCooked) return;

        const recipe = get().recipes.find((r) => r.id === entry.recipeId);
        if (recipe) {
          // Consumo automático de ingredientes
          const inventoryStore = useInventoryStore.getState();
          recipe.ingredients.forEach((ing) => {
            inventoryStore.removeItem(ing.ingredientId, ing.amount);
          });
        }

        set((state) => ({
          entries: state.entries.map((e) => (e.id === entryId ? { ...e, isCooked: true } : e)),
        }));
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
      version: 1, // Incrementado para forzar la carga de los nuevos mocks
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
