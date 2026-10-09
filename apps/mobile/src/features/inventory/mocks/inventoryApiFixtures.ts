import type { InventoryItem, InventoryMutationEvent, InventoryView } from '../types';

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
