export type MockMealType = 'desayuno' | 'almuerzo' | 'cena';

export type MockCourseType = 'entrada' | 'principal' | 'postre' | 'ensalada' | 'snack';

export type MockMealPlan = {
  mealType: MockMealType;
  courseType: MockCourseType;
  description: string;
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
      mealType: 'almuerzo',
      courseType: 'principal',
      description: 'Pollo al horno con papas y ensalada fresca.',
      ingredients: ['pollo', 'papa', 'tomate', 'lechuga', 'aceite de oliva', 'sal'],
      recipe:
        'Condimentar el pollo, hornear 40 minutos a 200C y servir con papas asadas y ensalada.',
    },
    {
      mealType: 'cena',
      courseType: 'ensalada',
      description: 'Ensalada tibia de quinoa con vegetales salteados.',
      ingredients: ['quinoa', 'zanahoria', 'brocoli', 'cebolla morada', 'limon', 'sal'],
      recipe: 'Cocinar quinoa, saltear vegetales y mezclar con jugo de limon y sal.',
    },
  ],
  [tomorrowKey]: [
    {
      mealType: 'desayuno',
      courseType: 'principal',
      description: 'Avena cremosa con banana y canela.',
      ingredients: ['avena', 'leche', 'banana', 'canela'],
      recipe: 'Cocinar la avena con leche 8 minutos y terminar con banana y canela.',
    },
    {
      mealType: 'almuerzo',
      courseType: 'principal',
      description: 'Pasta integral con salsa de tomate y albahaca.',
      ingredients: ['pasta integral', 'tomate triturado', 'ajo', 'albahaca', 'aceite'],
      recipe: 'Hervir pasta, cocinar salsa 15 minutos y mezclar antes de servir.',
    },
  ],
  [inTwoDaysKey]: [
    {
      mealType: 'cena',
      courseType: 'principal',
      description: 'Tacos de pescado con repollo y yogur.',
      ingredients: ['pescado blanco', 'tortillas', 'repollo', 'yogur', 'limon'],
      recipe: 'Cocinar el pescado a la plancha, armar tacos y agregar salsa de yogur.',
    },
  ],
  [inThreeDaysKey]: [
    {
      mealType: 'almuerzo',
      courseType: 'postre',
      description: 'Yogur natural con frutas y granola casera.',
      ingredients: ['yogur natural', 'frutillas', 'banana', 'granola'],
      recipe: 'Servir en capas yogur, frutas cortadas y granola encima.',
    },
  ],
};

export function getMockMealsForDate(dateKey: string): MockMealPlan[] {
  return mockPlanByDate[dateKey] ?? [];
}

export function getMockMealsByType(dateKey: string, mealType: MockMealType): MockMealPlan[] {
  return getMockMealsForDate(dateKey).filter((meal) => meal.mealType === mealType);
}
