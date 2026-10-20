import type { MealSlot } from '@/types/domain';

// What `GET /api/calendar` serves for one scheduled meal. A slot without a recipe is a row the
// server keeps for a meal that is not planned yet: `recipeId` and `recipeName` are null.
export interface CalendarMeal {
  mealId: string;
  date: string;
  slot: MealSlot;
  recipeId: string | null;
  recipeName: string | null;
  isFavorite: boolean;
  isCooked: boolean;
  // The meal is on the Account's today and has an active Cooking session, so the server refuses
  // to move it (issue #337). Optional: a server older than issue #207 does not send it.
  isCooking?: boolean;
  // The meal passed and was not cooked: it was answered "not cooked", or its 7-day confirmation
  // window closed unanswered (issue #145). Optional, so a test fixture can leave it out.
  isSkipped?: boolean;
  selectedQuantity: number | null;
  prepTimeMinutes: number | null;
  macros: { calories: number | null };
}

export interface CalendarRead {
  startDate: string;
  endDate: string;
  today: string;
  meals: CalendarMeal[];
}

export interface CalendarQuery {
  startDate: string;
  endDate: string;
}

// The body of `POST /api/calendar/meals/:mealId/move`: where the meal goes.
export interface CalendarMealDestination {
  date: string;
  slot: MealSlot;
}
