import type { UnitType } from '@/types/domain';

// Categories of the inventory API. The screen draws them through `toDisplayCategory`.
export const INVENTORY_CATEGORIES = [
  'lacteos',
  'frutas',
  'verduras',
  'carnes',
  'granos',
  'congelados',
  'no_perecederos',
  'otros',
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export type InventorySourceKind = 'planned' | 'extra';

export type InventoryFreshness = 'ok' | 'warning' | 'expired';

// A lot as the inventory API serves it
export interface InventoryItem {
  id: string;
  ingredientId: string;
  name: string;
  category: InventoryCategory;
  quantityMilli: number; // Integer, in thousandths of `unit`
  unit: UnitType;
  sourceKind: InventorySourceKind;
  acquiredAt: string | null; // ISO datetime
  expiresAt: string; // 'YYYY-MM-DD', explicit or inferred by the API
  freshness: InventoryFreshness;
  isLeftover: boolean;
  notes: string | null;
}

export interface InventoryMutationEvent {
  id: string;
  inventoryItemId: string;
  triggerType: 'purchase' | 'cooking' | 'manual' | 'voice';
  operation: 'add' | 'subtract' | 'set' | 'delete';
  quantityBeforeMilli: number;
  quantityDeltaMilli: number;
  quantityAfterMilli: number;
  insertedAt: string;
}

export interface InventoryView {
  sections: Record<InventoryFreshness, InventoryItem[]>;
  byCategory: Partial<Record<InventoryCategory, InventoryItem[]>>;
  extras: InventoryItem[];
  totals: { itemsCount: number; warningCount: number; expiredCount: number };
}

// The ingredient goes by id or by its exact catalog name; the id wins when both are sent.
export interface AddExtraItemPayload {
  ingredientId?: string;
  ingredientName?: string;
  quantityMilli: number; // Integer above zero
  unit: UnitType;
  expiresAt?: string; // 'YYYY-MM-DD'
  notes?: string;
  isLeftover?: boolean;
}

export interface InventoryItemWrite {
  item: InventoryItem;
  mutationEvent: InventoryMutationEvent;
}

export interface InventoryItemDisposal {
  disposed: true;
  mutationEvent: InventoryMutationEvent;
}

// What the voice parser understood from a transcript. Subtract only.
export interface VoiceIntent {
  operation: 'subtract';
  ingredientId: string;
  name: string;
  quantityMilli: number; // Integer above zero
  unit: UnitType;
}

export interface VoicePreview {
  // True below the confidence the API trusts: the intent must not be applied unconfirmed
  confirmationRequired: boolean;
  confidence: number; // 0..1
  intent: VoiceIntent;
}

export interface VoiceApplyPayload {
  transcript: string;
  intent: VoiceIntent;
  confirmed: boolean;
}

export interface VoiceApplyResult {
  ingredientId: string;
  quantityDeltaMilli: number; // Negative
  mutationEvents: InventoryMutationEvent[];
}
