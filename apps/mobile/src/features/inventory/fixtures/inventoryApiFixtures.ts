import type {
  InventoryItem,
  InventoryMutationEvent,
  InventoryView,
  VoiceApplyResult,
  VoicePreview,
} from '../types';

// Frozen answers of the inventory API, shaped as section 6 of the integration guide.
export const RICE: InventoryItem = {
  id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e01',
  ingredientId: '7d1e2f30-0000-4000-8000-000000000001',
  name: 'Arroz',
  category: 'no_perecederos',
  quantityMilli: 1_500_000,
  unit: 'g',
  sourceKind: 'planned',
  acquiredAt: '2026-10-01T12:00:00.000000Z',
  expiresAt: '2027-04-01',
  freshness: 'ok',
  isLeftover: false,
  notes: null,
};

export const ONION: InventoryItem = {
  id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e02',
  ingredientId: '7d1e2f30-0000-4000-8000-000000000002',
  name: 'Cebolla',
  category: 'verduras',
  quantityMilli: 3_000,
  unit: 'unit',
  sourceKind: 'planned',
  acquiredAt: '2026-10-05T12:00:00.000000Z',
  expiresAt: '2026-10-25',
  freshness: 'ok',
  isLeftover: false,
  notes: null,
};

export const STEW: InventoryItem = {
  id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e03',
  ingredientId: '7d1e2f30-0000-4000-8000-000000000003',
  name: 'Guiso de lentejas',
  category: 'otros',
  quantityMilli: 500,
  unit: 'unit',
  sourceKind: 'extra',
  acquiredAt: null,
  expiresAt: '2026-10-12',
  freshness: 'ok',
  isLeftover: true,
  notes: 'Del martes',
};

export const MILK: InventoryItem = {
  id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e04',
  ingredientId: '7d1e2f30-0000-4000-8000-000000000004',
  name: 'Leche',
  category: 'lacteos',
  quantityMilli: 750_000,
  unit: 'ml',
  sourceKind: 'extra',
  acquiredAt: null,
  expiresAt: '2026-10-10',
  freshness: 'warning',
  isLeftover: false,
  notes: 'Abierta',
};

export const CHICKEN: InventoryItem = {
  id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e05',
  ingredientId: '7d1e2f30-0000-4000-8000-000000000005',
  name: 'Pollo',
  category: 'carnes',
  quantityMilli: 300_000,
  unit: 'g',
  sourceKind: 'planned',
  acquiredAt: '2026-09-28T12:00:00.000000Z',
  expiresAt: '2026-10-02',
  freshness: 'expired',
  isLeftover: false,
  notes: null,
};

// A lot of the Ingredient the recipe fixture `recipe/fixtures/recipeDetail.json` asks for first.
export const POTATO: InventoryItem = {
  id: '0b7a1c52-6f0e-4d0a-9d3f-1c2b3a4d5e0a',
  ingredientId: '1c3e5a7b-9d2f-4b6c-8e1a-3f5d7b9c2e4a',
  name: 'Papa',
  category: 'verduras',
  quantityMilli: 800_000,
  unit: 'g',
  sourceKind: 'planned',
  acquiredAt: '2026-10-06T12:00:00.000000Z',
  expiresAt: '2026-11-05',
  freshness: 'ok',
  isLeftover: false,
  notes: null,
};

// A lot for a test that only cares about some of its fields.
export function buildInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return { ...RICE, ...overrides };
}

export const INVENTORY_VIEW: InventoryView = {
  sections: {
    ok: [RICE, ONION, STEW],
    warning: [MILK],
    expired: [CHICKEN],
  },
  byCategory: {
    no_perecederos: [RICE],
    verduras: [ONION],
    otros: [STEW],
    lacteos: [MILK],
    carnes: [CHICKEN],
  },
  extras: [STEW, MILK],
  totals: { itemsCount: 5, warningCount: 1, expiredCount: 1 },
};

export function mutationEvent(
  item: Pick<InventoryItem, 'id'>,
  overrides: Partial<InventoryMutationEvent> = {}
): InventoryMutationEvent {
  return {
    id: '5c9d0e1f-0000-4000-8000-0000000000aa',
    inventoryItemId: item.id,
    triggerType: 'manual',
    operation: 'set',
    quantityBeforeMilli: 0,
    quantityDeltaMilli: 0,
    quantityAfterMilli: 0,
    insertedAt: '2026-10-08T17:02:11.482913Z',
    ...overrides,
  };
}

// Voice adjustment: "usé 500 gramos de arroz" is parsed with confidence, "usé un poco de arroz"
// is not and has to be confirmed by the User.
export const VOICE_TRANSCRIPT_HIGH = 'usé 500 gramos de arroz';
export const VOICE_TRANSCRIPT_LOW = 'usé un poco de arroz';

const VOICE_RICE_INTENT = Object.freeze({
  operation: 'subtract',
  ingredientId: RICE.ingredientId,
  name: 'Arroz',
  quantityMilli: 500_000,
  unit: 'g',
} as const);

export const VOICE_PREVIEW_HIGH_CONFIDENCE: VoicePreview = Object.freeze({
  confirmationRequired: false,
  confidence: 0.95,
  intent: VOICE_RICE_INTENT,
});

export const VOICE_PREVIEW_LOW_CONFIDENCE: VoicePreview = Object.freeze({
  confirmationRequired: true,
  confidence: 0.55,
  intent: VOICE_RICE_INTENT,
});

export const VOICE_APPLY_RESULT: VoiceApplyResult = Object.freeze({
  ingredientId: RICE.ingredientId,
  quantityDeltaMilli: -500_000,
  mutationEvents: [
    mutationEvent(RICE, {
      triggerType: 'voice',
      operation: 'subtract',
      quantityBeforeMilli: 1_500_000,
      quantityDeltaMilli: -500_000,
      quantityAfterMilli: 1_000_000,
    }),
  ],
});

// A stock that drifted under the sheet: the preview asked again reads another quantity, and the
// apply is capped at the 300 g the lot still holds.
export const VOICE_PREVIEW_AFTER_DRIFT: VoicePreview = Object.freeze({
  confirmationRequired: false,
  confidence: 0.95,
  intent: Object.freeze({ ...VOICE_RICE_INTENT, quantityMilli: 400_000 }),
});

export const VOICE_APPLY_RESULT_CAPPED: VoiceApplyResult = Object.freeze({
  ingredientId: RICE.ingredientId,
  quantityDeltaMilli: -300_000,
  mutationEvents: [
    mutationEvent(RICE, {
      triggerType: 'voice',
      operation: 'subtract',
      quantityBeforeMilli: 300_000,
      quantityDeltaMilli: -300_000,
      quantityAfterMilli: 0,
    }),
  ],
});

// What `fetch` resolves to, as far as the transport reads a response.
function jsonResponse(payload: unknown, status: number): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

export function dataResponse(data: unknown): Promise<Response> {
  return jsonResponse({ data }, 200);
}

export function errorResponse(code: string, message: string, status: number): Promise<Response> {
  return jsonResponse({ error: { code, message } }, status);
}
