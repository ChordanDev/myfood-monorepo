import { Ingredient, MasterRecipe, MealPlanEntry } from '../types/domain';

export const MOCK_INGREDIENTS: Ingredient[] = [
  { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'i2', name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
  { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
  { id: 'i4', name: 'Cebolla', category: 'verduras', basePrice: 2, unit: 'unit' },
  { id: 'i5', name: 'Aceite de Oliva', category: 'almacen', basePrice: 15, unit: 'ml' },
  { id: 'i6', name: 'Fideos de Pasta', category: 'almacen', basePrice: 4, unit: 'g' },
  { id: 'i7', name: 'Espinaca', category: 'verduras', basePrice: 5, unit: 'g' },
];

export const MOCK_MASTER_RECIPES: MasterRecipe[] = [
  {
    id: 'r1',
    name: 'Pollo con Arroz y Tomate',
    description: 'Una receta clásica, balanceada y económica.',
    estimatedCost: 15.5,
    tags: ['económica', 'rápida', 'balanceada'],
    ingredients: [
      { ingredientId: 'i1', amount: 100 },
      { ingredientId: 'i2', amount: 200 },
      { ingredientId: 'i3', amount: 2 },
      { ingredientId: 'i5', amount: 10 },
    ],
    steps: [
      { order: 1, instruction: 'Cocinar el arroz en agua con sal durante 15 minutos.' },
      { order: 2, instruction: 'Cortar el pollo en cubos y saltear con aceite de oliva.' },
      { order: 3, instruction: 'Agregar el tomate picado al pollo y cocinar 5 minutos más.' },
      { order: 4, instruction: 'Servir el pollo sobre la cama de arroz.' },
    ],
    imageUrl:
      '/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png',
    theme: {
      colorBlack: '#0D1007',
      colorDark: '#15180F',
      colorMedium: '#364025',
      colorLight: '#8D9373',
      primaryAccent: '#EF9432',
      appBg: '#BCBFA7',
      icon: '#D8D98B',
      textBlack: '#0D1007',
      textDark: '#1B210E',
      textMedium: '#D8D98B',
      textLight: '#F5F3D4',
      primaryAccentIntense: '#FF8400',
      alert: '#C94F3D',
    },
  },
  {
    id: 'r2',
    name: 'Pasta con Espinaca',
    description: 'Pasta ligera con espinacas frescas y un toque de aceite de oliva.',
    estimatedCost: 10.0,
    tags: ['vegetariana', 'muy barato', 'saludable'],
    ingredients: [
      { ingredientId: 'i6', amount: 120 },
      { ingredientId: 'i7', amount: 100 },
      { ingredientId: 'i5', amount: 15 },
    ],
    steps: [
      { order: 1, instruction: 'Hervir la pasta hasta que esté al dente.' },
      { order: 2, instruction: 'Lavar y trocear la espinaca.' },
      { order: 3, instruction: 'Saltear la espinaca brevemente con aceite de oliva.' },
      { order: 4, instruction: 'Mezclar la pasta con la espinaca y servir.' },
    ],
    imageUrl:
      '/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png',
    theme: {
      colorBlack: '#0D1007',
      colorDark: '#15180F',
      colorMedium: '#364025',
      colorLight: '#8D9373',
      primaryAccent: '#EF9432',
      appBg: '#BCBFA7',
      icon: '#D8D98B',
      textBlack: '#0D1007',
      textDark: '#1B210E',
      textMedium: '#D8D98B',
      textLight: '#F5F3D4',
      primaryAccentIntense: '#FF8400',
      alert: '#C94F3D',
    },
  },
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
