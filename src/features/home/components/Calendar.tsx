import { useMemo, useState } from 'react';
import { Calendar as RNCalendar, DateData, LocaleConfig } from 'react-native-calendars';

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

const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const DAY_TEXT = '#2C2F1D';
const DISABLED_TEXT = 'rgba(44, 47, 29, 0.45)';
const TODAY_BG = '#2F4A33';
const TODAY_TEXT = '#F6F2E8';
const PLANNED_BG = '#A8C48A';

LocaleConfig.locales.es = {
  monthNames: MONTHS,
  monthNamesShort: [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'],
  dayNamesShort: WEEKDAYS,
};
LocaleConfig.defaultLocale = 'es';

export type MealPlan = {
  mealType: string;
  courseType: string;
  description: string;
  ingredients: string[];
  recipe: string;
};

export type PlanByDate = Record<string, MealPlan[]>;

type CalendarProps = {
  planByDate?: PlanByDate;
  selectedDate?: string | null;
  onSelectDate?: (dateString: string) => void;
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getMonthDateKeys(year: number, month: number) {
  const totalDays = new Date(year, month + 1, 0).getDate();
  const keys: string[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    keys.push(formatDateKey(new Date(year, month, day)));
  }

  return keys;
}

function isSelectableDate(dateString: string, planByDate: PlanByDate, today: Date) {
  const dayDate = parseDateKey(dateString);
  const isPast = dayDate < today;
  const isPlanned = Boolean(planByDate[dateString]?.length);
  return !isPast && isPlanned;
}

type MarkedDate = {
  selected?: boolean;
  selectedColor?: string;
  selectedTextColor?: string;
  disabled?: boolean;
  disableTouchEvent?: boolean;
};

export function Calendar({ planByDate = {}, selectedDate, onSelectDate }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [internalSelectedDate, setInternalSelectedDate] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const todayKey = formatDateKey(today);
  const activeSelectedDate = selectedDate === undefined ? internalSelectedDate : selectedDate;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthDateKeys = useMemo(() => getMonthDateKeys(year, month), [year, month]);

  const markedDates = useMemo(() => {
    const marks: Record<string, MarkedDate> = {};

    monthDateKeys.forEach((dateKey) => {
      const dayDate = parseDateKey(dateKey);
      const isPast = dayDate < today;
      const isToday = dateKey === todayKey;
      const isPlanned = Boolean(planByDate[dateKey]?.length);
      const isSelected = activeSelectedDate === dateKey;
      const isSelectable = !isPast && isPlanned;

      if (isToday || isPlanned || isSelected) {
        marks[dateKey] = {
          selected: true,
          selectedColor: isSelected || isToday ? TODAY_BG : PLANNED_BG,
          selectedTextColor: isSelected || isToday ? TODAY_TEXT : DAY_TEXT,
          disabled: !isSelectable && !isToday,
          disableTouchEvent: !isSelectable,
        };
      } else {
        marks[dateKey] = {
          disabled: true,
          disableTouchEvent: true,
        };
      }
    });

    return marks;
  }, [activeSelectedDate, monthDateKeys, planByDate, today, todayKey]);

  const handleMonthChange = (date: DateData) => {
    setCurrentMonth(new Date(date.year, date.month - 1, 1));
  };

  const handleSelectDate = (dateString: string) => {
    onSelectDate?.(dateString);
    if (selectedDate === undefined) {
      setInternalSelectedDate(dateString);
    }
  };

  return (
    <RNCalendar
      current={formatDateKey(currentMonth)}
      onMonthChange={handleMonthChange}
      onDayPress={(date) => {
        if (!isSelectableDate(date.dateString, planByDate, today)) {
          return;
        }
        handleSelectDate(date.dateString);
      }}
      markedDates={markedDates}
      firstDay={0}
      enableSwipeMonths
      disableAllTouchEventsForInactiveDays
      theme={{
        textDisabledColor: DISABLED_TEXT,
      }}
    />
  );
}
