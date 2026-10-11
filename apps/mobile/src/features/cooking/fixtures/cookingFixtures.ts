import type {
  CookingAnswer,
  CookingChatMessage,
  CookingFinish,
  CookingSession,
} from '../types/cookingApi';

// Answers of the Cooking session endpoints for one lunch: the rice came from two lots, the
// oil from one, and the stock could not cover all the salt.

export const COOKING_SESSION_ID = '0b5f2c0e-5a43-4a5e-9a39-3d7f6a1c2b11';
export const COOKING_SCHEDULED_MEAL_ID = 'fa64644f-e007-4539-9cd6-2a9d49570540';

export const COOKING_START: CookingSession = {
  sessionId: COOKING_SESSION_ID,
  scheduledMealId: COOKING_SCHEDULED_MEAL_ID,
  status: 'active',
  chatMessages: [],
};

// One question already answered, then the next one: the turns of a second `ask`.
export const COOKING_CHAT_HISTORY: CookingChatMessage[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    role: 'user',
    content: '¿Puedo usar menos aceite?',
    insertedAt: '2026-10-08T12:00:00.000000Z',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000002',
    role: 'assistant',
    content: 'Sí, con la mitad alcanza.',
    insertedAt: '2026-10-08T12:00:00.000001Z',
  },
];

export const COOKING_SESSION_WITH_HISTORY: CookingSession = {
  ...COOKING_START,
  chatMessages: COOKING_CHAT_HISTORY,
};

// What start and the session read answer for a cooked meal: the closed conversation.
export const COOKING_SESSION_FINISHED: CookingSession = {
  ...COOKING_SESSION_WITH_HISTORY,
  status: 'completed',
};

export const COOKING_QUESTION = '¿Cuánto tarda el arroz?';

export const COOKING_ANSWER: CookingAnswer = {
  sessionId: COOKING_SESSION_ID,
  message: 'Unos 18 minutos a fuego bajo.',
  turns: [
    {
      id: 'c1000000-0000-4000-8000-000000000003',
      role: 'user',
      content: COOKING_QUESTION,
      insertedAt: '2026-10-08T12:05:00.000000Z',
    },
    {
      id: 'c1000000-0000-4000-8000-000000000004',
      role: 'assistant',
      content: 'Unos 18 minutos a fuego bajo.',
      insertedAt: '2026-10-08T12:05:00.000001Z',
    },
  ],
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

// Start and the session read answer with the same payload.
export function toCookingSessionResponse(session: CookingSession = COOKING_START) {
  return { data: { ...session, slot: 'lunch', snapshot: {} } };
}

export function toCookingAnswerResponse(answer: CookingAnswer = COOKING_ANSWER) {
  return { data: { ...answer, contentType: 'text', stepContext: {} } };
}

export function toCookingFinishResponse(finish: CookingFinish = COOKING_FINISH_WITH_SHORTAGE) {
  return { data: finish };
}
