import type { MealSlot } from '@/types/domain';

// Spanish label of every meal slot. The display order is `ORDERED_MEAL_SLOTS`.
export const MEAL_SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  snack: 'Snack',
  dinner: 'Cena',
};
