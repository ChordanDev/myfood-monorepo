export type MealPlan = {
  mealType: string;
  courseType: string;
  description: string;
  ingredients: string[];
  recipe: string;
};

export type PlanByDate = Record<string, MealPlan[]>;

export type CalendarProps = {
  planByDate?: PlanByDate;
  selectedDate?: string | null;
  onSelectDate?: (dateString: string) => void;
  daySize?: number;
  viewportHeight?: number;
  minHeight?: number;
};

export type MarkedDate = {
  selected?: boolean;
  selectedColor?: string;
  selectedTextColor?: string;
  disabled?: boolean;
  disableTouchEvent?: boolean;
};
