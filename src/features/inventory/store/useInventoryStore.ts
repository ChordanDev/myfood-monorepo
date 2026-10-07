import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import type { Ingredient } from '@/types/domain';
import { safeAsyncStorage } from '@/utils/safeAsyncStorage';
import { MOCK_INVENTORY } from '../mocks';
import type { InventoryItem, InventoryItemPatch } from '../types';

interface InventoryState {
  items: InventoryItem[];
  ingredients: Ingredient[];
  addItem: (ingredientId: string, amount: number) => void;
  consumeIngredient: (ingredientId: string, amount: number) => void;
  updateItem: (id: string, patch: InventoryItemPatch) => void;
  removeItem: (id: string) => void;
  getIngredient: (id: string) => Ingredient | undefined;
}

type PersistedInventoryState = Pick<InventoryState, 'items' | 'ingredients'>;

// Shape persisted before the store was versioned
interface LegacyInventoryItem {
  ingredientId: string;
  amount: number;
  isLeftover?: boolean;
}

function applyItemPatch(item: InventoryItem, patch: InventoryItemPatch): InventoryItem {
  const next: InventoryItem = { ...item };

  const name = patch.name?.trim();
  if (name) next.name = name;

  // A quantity typed by the user is in the normalized unit, so it is no longer an estimate
  if (patch.quantity !== undefined && Number.isFinite(patch.quantity) && patch.quantity >= 0) {
    next.quantity = patch.quantity;
    next.confidence = 'exact';
  }

  if (patch.notes !== undefined) {
    const notes = patch.notes.trim();
    if (notes) next.notes = notes;
    else delete next.notes;
  }

  return next;
}

export function migrateInventoryState(
  persistedState: unknown,
  version: number
): PersistedInventoryState {
  if (version >= 1) return persistedState as PersistedInventoryState;

  // The legacy catalog used retired categories and units, so it is replaced by the current one
  const legacyItems = (persistedState as { items?: LegacyInventoryItem[] } | null)?.items ?? [];
  const items = legacyItems.flatMap((legacyItem): InventoryItem[] => {
    const ingredient = MOCK_INGREDIENTS.find((i) => i.id === legacyItem.ingredientId);
    if (!ingredient) return [];

    return [
      {
        id: `inv-${ingredient.id}`,
        ingredientId: ingredient.id,
        name: ingredient.name,
        category: ingredient.category,
        quantity: legacyItem.amount,
        unit: ingredient.unit,
        confidence: 'estimated',
        ...(legacyItem.isLeftover !== undefined && { isLeftover: legacyItem.isLeftover }),
      },
    ];
  });

  return { items, ingredients: MOCK_INGREDIENTS };
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
                i.id === existingItem.id ? { ...i, quantity: i.quantity + amount } : i
              ),
            };
          }

          const ingredient = state.ingredients.find((i) => i.id === ingredientId);
          if (!ingredient) return state;

          const newItem: InventoryItem = {
            id: `inv-${ingredientId}`,
            ingredientId,
            name: ingredient.name,
            category: ingredient.category,
            quantity: amount,
            unit: ingredient.unit,
            confidence: 'estimated',
          };
          return { items: [...state.items, newItem] };
        });
      },
      consumeIngredient: (ingredientId, amount) => {
        set((state) => {
          const existingItem = state.items.find((i) => i.ingredientId === ingredientId);
          if (!existingItem) return state;

          // Inventory never goes negative and an item that ran out keeps its record
          return {
            items: state.items.map((i) =>
              i.id === existingItem.id ? { ...i, quantity: Math.max(0, i.quantity - amount) } : i
            ),
          };
        });
      },
      updateItem: (id, patch) => {
        set((state) => ({
          items: state.items.map((i) => (i.id === id ? applyItemPatch(i, patch) : i)),
        }));
      },
      removeItem: (id) => {
        // Deleting only zeroes the visible quantity; the record is kept as history
        set((state) => ({
          items: state.items.map((i) => (i.id === id ? { ...i, quantity: 0 } : i)),
        }));
      },
      getIngredient: (id) => {
        return get().ingredients.find((i) => i.id === id);
      },
    }),
    {
      name: 'inventory-storage',
      version: 1, // Self-contained items with PRD categories and units
      storage: createJSONStorage(() => safeAsyncStorage),
      partialize: ({ items, ingredients }) => ({ items, ingredients }),
      migrate: migrateInventoryState,
    }
  )
);
