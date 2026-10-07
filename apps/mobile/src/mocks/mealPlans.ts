// Datos mock para desarrollo. Usa la forma canonica del Plan de Comidas Local.
import type { MealPlanEntry, MealType } from '@/types/domain';
import type { PlanByDate } from '@/features/home/types/calendar';

// Re-exporta los tipos canonicos para consumidores existentes.
export type { MealType, PlanByDate };

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

// Genera las claves de fecha de forma lazy para evitar datos estáticos
// que se vuelven obsoletos si la app permanece abierta entre dias.
function buildMockPlanByDate(): PlanByDate {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const tomorrowKey = formatDateKey(addDays(today, 1));
  const inTwoDaysKey = formatDateKey(addDays(today, 2));
  const inThreeDaysKey = formatDateKey(addDays(today, 3));

  return {
    [todayKey]: [
      {
        id: 'mock-mp1',
        date: todayKey,
        type: 'almuerzo',
        recipeId: 'r1',
        isCooked: false,
      },
      {
        id: 'mock-mp2',
        date: todayKey,
        type: 'cena',
        recipeId: 'r2',
        isCooked: false,
      },
    ],
    [tomorrowKey]: [
      {
        id: 'mock-mp3',
        date: tomorrowKey,
        type: 'desayuno',
        recipeId: 'r2',
        isCooked: false,
      },
      {
        id: 'mock-mp4',
        date: tomorrowKey,
        type: 'almuerzo',
        recipeId: 'r1',
        isCooked: false,
      },
    ],
    [inTwoDaysKey]: [
      {
        id: 'mock-mp5',
        date: inTwoDaysKey,
        type: 'cena',
        recipeId: 'r1',
        isCooked: false,
      },
    ],
    [inThreeDaysKey]: [
      {
        id: 'mock-mp6',
        date: inThreeDaysKey,
        type: 'almuerzo',
        recipeId: 'r2',
        isCooked: false,
      },
    ],
  };
}

// Expone un getter que regenera los datos al ser invocado.
// Para uso en componentes, se puede llamar una vez por render via useMemo.
export function getMockPlanByDate(): PlanByDate {
  return buildMockPlanByDate();
}

export function getMockMealsForDate(planByDate: PlanByDate, dateKey: string): MealPlanEntry[] {
  return planByDate[dateKey] ?? [];
}

export function getMockMealsByType(
  planByDate: PlanByDate,
  dateKey: string,
  mealType: MealType
): MealPlanEntry[] {
  return getMockMealsForDate(planByDate, dateKey).filter((meal) => meal.type === mealType);
}
