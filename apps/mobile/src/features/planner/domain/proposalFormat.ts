import type { PlannerMealSlot } from '../types/planningEvents';

export const MEAL_SLOT_LABELS: Record<PlannerMealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
  snack: 'Merienda',
};

// Fixed names instead of Intl so the output never depends on the device ICU data.
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const CENTS_PER_PESO = 100;

// es-AR pesos like the shopping list: thousands dot, no decimals. The API counts in cents.
export function formatCostCents(cents: number): string {
  const pesos = String(Math.round(cents / CENTS_PER_PESO));
  return `$${pesos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** `Martes 1 Enero` for the 'YYYY-MM-DD' key of a day. */
export function formatProposalDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}
