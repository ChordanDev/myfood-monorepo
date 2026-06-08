import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { InventoryItem, Ingredient } from '../types/domain';
import { MOCK_INVENTORY, MOCK_INGREDIENTS } from '../mocks/domainMocks';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';

interface InventoryState {
  items: InventoryItem[];
  ingredients: Ingredient[];
  addItem: (ingredientId: string, amount: number) => void;
  removeItem: (ingredientId: string, amount?: number) => void;
  updateItem: (ingredientId: string, amount: number) => void;
  getIngredient: (id: string) => Ingredient | undefined;
}

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: MOCK_INVENTORY,
      ingredients: MOCK_INGREDIENTS,
      addItem: (ingredientId, amount) => {
        set((state) => {
          const existingItem = state.items.find((i) => i.ingredientId === ingredientId);
          if (existingItem) {
            return {
              items: state.items.map((i) =>
                i.ingredientId === ingredientId ? { ...i, amount: i.amount + amount } : i
              ),
            };
          }
          return { items: [...state.items, { ingredientId, amount }] };
        });
      },
      removeItem: (ingredientId, amount) => {
        set((state) => {
          const existingItem = state.items.find((i) => i.ingredientId === ingredientId);
          if (!existingItem) return state;

          if (amount === undefined || existingItem.amount <= amount) {
            return { items: state.items.filter((i) => i.ingredientId !== ingredientId) };
          }

          return {
            items: state.items.map((i) =>
              i.ingredientId === ingredientId ? { ...i, amount: i.amount - amount } : i
            ),
          };
        });
      },
      updateItem: (ingredientId, amount) => {
        set((state) => ({
          items: state.items.map((i) => (i.ingredientId === ingredientId ? { ...i, amount } : i)),
        }));
      },
      getIngredient: (id) => {
        return get().ingredients.find((i) => i.id === id);
      },
    }),
    {
      name: 'inventory-storage',
      storage: createJSONStorage(() => safeAsyncStorage),
    }
  )
);
