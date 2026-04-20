export type MockMealType = 'desayuno' | 'almuerzo' | 'cena';

export type MockCourseType = 'entrada' | 'principal' | 'postre' | 'ensalada' | 'snack';

export type MockMealPlan = {
  tipo: MockMealType;
  mealType?: MockMealType;
  courseType: MockCourseType;
  descripcion: string;
  description?: string;
  ingredients: string[];
  recipe: string;
};

export type MockPlanByDate = Record<string, MockMealPlan[]>;

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

const today = new Date();
const todayKey = formatDateKey(today);
const tomorrowKey = formatDateKey(addDays(today, 1));
const inTwoDaysKey = formatDateKey(addDays(today, 2));
const inThreeDaysKey = formatDateKey(addDays(today, 3));

export const mockPlanByDate: MockPlanByDate = {
  [todayKey]: [
    {
      tipo: 'almuerzo',
      courseType: 'principal',
      descripcion: 'Pollo al horno con papas y ensalada fresca.',
      ingredients: ['pollo', 'papa', 'tomate', 'lechuga', 'aceite de oliva', 'sal'],
      recipe:
        'Condimentar el pollo, hornear 40 minutos a 200C y servir con papas asadas y ensalada.',
    },
    {
      tipo: 'cena',
      courseType: 'ensalada',
      descripcion: 'Ensalada tibia de quinoa con vegetales salteados.',
      ingredients: ['quinoa', 'zanahoria', 'brocoli', 'cebolla morada', 'limon', 'sal'],
      recipe: 'Cocinar quinoa, saltear vegetales y mezclar con jugo de limon y sal.',
    },
  ],
  [tomorrowKey]: [
    {
      tipo: 'desayuno',
      courseType: 'principal',
      descripcion: 'Avena cremosa con banana y canela.',
      ingredients: ['avena', 'leche', 'banana', 'canela'],
      recipe: 'Cocinar la avena con leche 8 minutos y terminar con banana y canela.',
    },
    {
      tipo: 'almuerzo',
      courseType: 'principal',
      descripcion: 'Pasta integral con salsa de tomate y albahaca.',
      ingredients: ['pasta integral', 'tomate triturado', 'ajo', 'albahaca', 'aceite'],
      recipe: 'Hervir pasta, cocinar salsa 15 minutos y mezclar antes de servir.',
    },
  ],
  [inTwoDaysKey]: [
    {
      tipo: 'cena',
      courseType: 'principal',
      descripcion: 'Tacos de pescado con repollo y yogur.',
      ingredients: ['pescado blanco', 'tortillas', 'repollo', 'yogur', 'limon'],
      recipe: 'Cocinar el pescado a la plancha, armar tacos y agregar salsa de yogur.',
    },
  ],
  [inThreeDaysKey]: [
    {
      tipo: 'almuerzo',
      courseType: 'postre',
      descripcion: 'Yogur natural con frutas y granola casera.',
      ingredients: ['yogur natural', 'frutillas', 'banana', 'granola'],
      recipe: 'Servir en capas yogur, frutas cortadas y granola encima.',
    },
  ],
};

export function getMockMealsForDate(dateKey: string): MockMealPlan[] {
  return mockPlanByDate[dateKey] ?? [];
}

export function getMockMealType(meal: MockMealPlan): MockMealType {
  return meal.tipo ?? meal.mealType ?? 'almuerzo';
}

export function getMockMealDescription(meal: MockMealPlan): string {
  return meal.descripcion ?? meal.description ?? '';
}

export function getMockMealsByType(dateKey: string, mealType: MockMealType): MockMealPlan[] {
  return getMockMealsForDate(dateKey).filter((meal) => getMockMealType(meal) === mealType);
}
