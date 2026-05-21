import type { LocalMealPlanByDate } from '../domain/localMealPlan';

export type PlanByDate = LocalMealPlanByDate;

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
