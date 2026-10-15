import type { UnitType } from '@/types/domain';

// Answers of the Cooking session endpoints, as the server sends them (camelCase).

/** One turn of the Cooking chat, as the server stored it. */
export interface CookingChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  insertedAt: string;
  /**
   * On a question: the id the app sent it with, `null` when it was sent without one. Absent
   * when the API does not serve it.
   */
  clientMessageId?: string | null;
}

/**
 * The part of a Cooking session the app reads, from `POST /api/cooking/start` and from the
 * session read: the id the other calls need, whether it is still open and the chat history,
 * oldest first. A cooked meal answers with its `completed` session.
 */
export interface CookingSession {
  sessionId: string;
  scheduledMealId: string;
  status: 'active' | 'paused' | 'completed';
  chatMessages: CookingChatMessage[];
}

/** The answer to a question: the two turns the server stored, the user's first. */
export interface CookingAnswer {
  sessionId: string;
  message: string;
  turns: CookingChatMessage[];
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
