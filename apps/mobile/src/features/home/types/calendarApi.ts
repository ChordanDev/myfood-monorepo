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
