import { Ingredient, MealPlanEntry } from '../types/domain';

export const MOCK_INGREDIENTS: Ingredient[] = [
  { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'i2', name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
  { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
  { id: 'i4', name: 'Cebolla', category: 'verduras', basePrice: 2, unit: 'unit' },
  { id: 'i5', name: 'Aceite de Oliva', category: 'almacen', basePrice: 15, unit: 'ml' },
  { id: 'i6', name: 'Fideos de Pasta', category: 'almacen', basePrice: 4, unit: 'g' },
  { id: 'i7', name: 'Espinaca', category: 'verduras', basePrice: 5, unit: 'g' },
];

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

const today = new Date();

export const MOCK_MEAL_PLAN: MealPlanEntry[] = [
  {
    id: 'mp1',
    date: formatDateKey(today),
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
  },
  {
    id: 'mp2',
    date: formatDateKey(today),
    type: 'dinner',
    recipeId: 'r2',
    isCooked: false,
  },
  {
    id: 'mp3',
    date: formatDateKey(addDays(today, 1)),
    type: 'breakfast',
    recipeId: 'r2',
    isCooked: false,
  },
  {
    id: 'mp4',
    date: formatDateKey(addDays(today, 1)),
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
  },
  {
    id: 'mp5',
    date: formatDateKey(addDays(today, 2)),
    type: 'dinner',
    recipeId: 'r1',
    isCooked: false,
  },
  {
    id: 'mp6',
    date: formatDateKey(addDays(today, 3)),
    type: 'lunch',
    recipeId: 'r2',
    isCooked: false,
  },
  // Past days: yesterday is still waiting for a confirmation, the day before is already confirmed.
  {
    id: 'mp7',
    date: formatDateKey(addDays(today, -1)),
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
  },
  {
    id: 'mp8',
    date: formatDateKey(addDays(today, -1)),
    type: 'dinner',
    recipeId: 'r2',
    isCooked: false,
  },
  {
    id: 'mp9',
    date: formatDateKey(addDays(today, -2)),
    type: 'lunch',
    recipeId: 'r2',
    isCooked: true,
  },
  {
    id: 'mp10',
    date: formatDateKey(addDays(today, -2)),
    type: 'dinner',
    recipeId: 'r1',
    isCooked: true,
  },
];
