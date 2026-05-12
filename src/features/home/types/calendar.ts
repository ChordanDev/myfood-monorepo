// Tipos canonicos de comidas y planes. Fuente unica de verdad.
export type MealType = 'desayuno' | 'almuerzo' | 'cena';

export type CourseType = 'entrada' | 'principal' | 'postre' | 'ensalada' | 'snack';

export type MealPlan = {
  tipo: MealType;
  courseType: CourseType;
  descripcion: string;
  ingredients: string[];
  recipe: string;
};

export type PlanByDate = Record<string, MealPlan[]>;

export type MonthGridCell = {
  date: Date;
  isCurrentMonth: boolean;
};

export type CalendarProps = {
  planByDate?: PlanByDate;
  selectedDate?: string | null;
  onSelectDate?: (dateString: string) => void;
  daySize?: number;
  monthFontSize?: number;
  navFontSize?: number;
  weekdayFontSize?: number;
  dayFontSize?: number;
};
