import type { UnitType } from '@/types/domain';

// Answers of the Cooking session endpoints, as the server sends them (camelCase).

/** The part of the `POST /api/cooking/start` answer the app reads: the id the finish call needs. */
export interface CookingSessionStart {
  sessionId: string;
  scheduledMealId: string;
}

export interface CookedScheduledMeal {
  id: string;
  date: string;
  slot: string;
  isCooked: boolean;
  isSkipped: boolean;
  recipeId: string;
  recipeVersionId: string;
  selectedQuantity: number;
  recipeName: string;
}

/** One lot an Ingredient was taken from; quantities are in thousandths of the unit. */
export interface InventoryMutation {
  inventoryItemId: string;
  ingredientId: string;
  ingredientName: string;
  unit: UnitType;
  quantityBeforeMilli: number;
  quantityDeltaMilli: number;
  quantityAfterMilli: number;
}

/** An Ingredient the stock could not cover. */
export interface CookingShortage {
  ingredientId: string;
  ingredientName: string;
  unit: UnitType;
  requestedMilli: number;
  missingMilli: number;
}

export interface CookingFinish {
  scheduledMeal: CookedScheduledMeal;
  inventoryMutations: InventoryMutation[];
  shortages: CookingShortage[];
}
