import type { IngredientCategory, UnitType } from '@/types/domain';

export type QuantityConfidence = 'exact' | 'estimated';

export interface InventoryItem {
  id: string;
  ingredientId?: string; // Optional link to the ingredient catalog
  name: string;
  category: IngredientCategory;
  quantity: number; // Normalized amount, expressed in `unit`
  unit: UnitType;
  confidence: QuantityConfidence;
  notes?: string;
  isLeftover?: boolean;
}

export interface InventoryItemPatch {
  name?: string;
  quantity?: number;
  notes?: string;
}
