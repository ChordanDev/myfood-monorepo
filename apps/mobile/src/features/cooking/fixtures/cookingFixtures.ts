import type { CookingFinish, CookingSessionStart } from '../types/cookingApi';

// Answers of the Cooking session endpoints for one lunch: the rice came from two lots, the
// oil from one, and the stock could not cover all the salt.

export const COOKING_SESSION_ID = '0b5f2c0e-5a43-4a5e-9a39-3d7f6a1c2b11';
export const COOKING_SCHEDULED_MEAL_ID = 'fa64644f-e007-4539-9cd6-2a9d49570540';

export const COOKING_START: CookingSessionStart = {
  sessionId: COOKING_SESSION_ID,
  scheduledMealId: COOKING_SCHEDULED_MEAL_ID,
};

export const COOKING_FINISH_WITH_SHORTAGE: CookingFinish = {
  scheduledMeal: {
    id: COOKING_SCHEDULED_MEAL_ID,
    date: '2026-10-08',
    slot: 'lunch',
    isCooked: true,
    isSkipped: false,
    recipeId: '7d1c8c0a-62b1-4a0e-8d5b-8d1d0a0f6b01',
    recipeVersionId: '3e5b9d7e-1f4a-4c53-b1a2-9a6a4b1c7d02',
    selectedQuantity: 1,
    recipeName: 'Arroz con aceite',
  },
  inventoryMutations: [
    {
      inventoryItemId: 'a1000000-0000-4000-8000-000000000001',
      ingredientId: 'dc0c856d-af87-4efb-8e75-1da2b0f57597',
      ingredientName: 'Arroz',
      unit: 'g',
      quantityBeforeMilli: 100000,
      quantityDeltaMilli: -100000,
      quantityAfterMilli: 0,
    },
    {
      inventoryItemId: 'a1000000-0000-4000-8000-000000000002',
      ingredientId: 'dc0c856d-af87-4efb-8e75-1da2b0f57597',
      ingredientName: 'Arroz',
      unit: 'g',
      quantityBeforeMilli: 500000,
      quantityDeltaMilli: -100000,
      quantityAfterMilli: 400000,
    },
    {
      inventoryItemId: 'a1000000-0000-4000-8000-000000000003',
      ingredientId: '5a8e4b21-7c1f-4d0a-9d0b-2c3e4f5a6b07',
      ingredientName: 'Aceite de oliva',
      unit: 'ml',
      quantityBeforeMilli: 30000,
      quantityDeltaMilli: -15000,
      quantityAfterMilli: 15000,
    },
  ],
  shortages: [
    {
      ingredientId: '9c2d7e30-1b4f-4a6c-8e5d-7f0a1b2c3d08',
      ingredientName: 'Sal',
      unit: 'g',
      requestedMilli: 5000,
      missingMilli: 5000,
    },
  ],
};

export const COOKING_FINISH_COVERED: CookingFinish = {
  ...COOKING_FINISH_WITH_SHORTAGE,
  shortages: [],
};

export function toCookingStartResponse(start: CookingSessionStart = COOKING_START) {
  return { data: { ...start, status: 'active', slot: 'lunch', snapshot: {}, chatMessages: [] } };
}

export function toCookingFinishResponse(finish: CookingFinish = COOKING_FINISH_WITH_SHORTAGE) {
  return { data: finish };
}
