import type { IngredientCategory } from '@/types/domain';
import type { InventoryCategory } from '../types';

// The API knows fewer categories than the screen draws: its dry goods all sit under "Despensa".
const DISPLAY_CATEGORY: Record<InventoryCategory, IngredientCategory> = {
  lacteos: 'lacteos',
  frutas: 'frutas',
  verduras: 'verduras',
  carnes: 'carnes',
  granos: 'almacen',
  congelados: 'congelados',
  no_perecederos: 'almacen',
  otros: 'otros',
};

const FALLBACK_DISPLAY_CATEGORY: IngredientCategory = 'otros';

// Takes any text: a category the API adds later is drawn as the generic one.
export function toDisplayCategory(category: string): IngredientCategory {
  return Object.prototype.hasOwnProperty.call(DISPLAY_CATEGORY, category)
    ? DISPLAY_CATEGORY[category as InventoryCategory]
    : FALLBACK_DISPLAY_CATEGORY;
}
