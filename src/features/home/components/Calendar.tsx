import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Calendar as RNCalendar, DateData } from 'react-native-calendars';
import '../constants/calendarLocale';
import type { CalendarProps, MarkedDate } from '../types/calendar';
import {
  formatDateKey,
  getMonthDateKeys,
  isSelectableDate,
  parseDateKey,
  startOfDay,
} from '../utils/calendarDate';

const DAY_TEXT = '#2C2F1D';
const DISABLED_TEXT = 'rgba(44, 47, 29, 0.45)';
const TODAY_BG = '#2F4A33';
const TODAY_TEXT = '#F6F2E8';
const PLANNED_BG = '#A8C48A';
const DEFAULT_DAY_SIZE = 42;
const DEFAULT_VIEWPORT_HEIGHT = 308;
const DEFAULT_MIN_HEIGHT = 360;
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

function formatMonthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function Calendar({
  planByDate = {},
  selectedDate,
  onSelectDate,
  daySize = DEFAULT_DAY_SIZE,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
  minHeight = DEFAULT_MIN_HEIGHT,
}: CalendarProps) {
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
  const monthLabel = `${MONTHS[month]} ${year}`;
  const currentMonthKey = formatMonthKey(year, month);

  const allowedMonthKeys = useMemo(() => {
    const keys = Object.keys(planByDate)
      .filter((dateKey) => Boolean(planByDate[dateKey]?.length))
      .map((dateKey) => dateKey.slice(0, 7));

    return Array.from(new Set(keys)).sort();
  }, [planByDate]);

  const currentMonthIndex = allowedMonthKeys.indexOf(currentMonthKey);
  const hasAllowedMonths = allowedMonthKeys.length > 0;

  useEffect(() => {
    if (!hasAllowedMonths) {
      return;
    }

    if (currentMonthIndex === -1) {
      setCurrentMonth(parseMonthKey(allowedMonthKeys[0]));
    }
  }, [allowedMonthKeys, currentMonthIndex, hasAllowedMonths]);

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

  const calendarTheme = useMemo(
    () =>
      ({
        textDisabledColor: DISABLED_TEXT,
        'stylesheet.day.basic': {
          base: {
            width: daySize,
            height: daySize,
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
      }) as any,
    [daySize]
  );

  const handleMonthChange = (date: DateData) => {
    const nextMonthKey = `${date.year}-${String(date.month).padStart(2, '0')}`;
    if (!hasAllowedMonths || allowedMonthKeys.includes(nextMonthKey)) {
      setCurrentMonth(new Date(date.year, date.month - 1, 1));
    }
  };

  const handlePrevAllowedMonth = () => {
    if (!hasAllowedMonths || currentMonthIndex <= 0) {
      return;
    }

    setCurrentMonth(parseMonthKey(allowedMonthKeys[currentMonthIndex - 1]));
  };

  const handleNextAllowedMonth = () => {
    if (
      !hasAllowedMonths ||
      currentMonthIndex === -1 ||
      currentMonthIndex >= allowedMonthKeys.length - 1
    ) {
      return;
    }

    setCurrentMonth(parseMonthKey(allowedMonthKeys[currentMonthIndex + 1]));
  };

  const handleSelectDate = (dateString: string) => {
    onSelectDate?.(dateString);
    if (selectedDate === undefined) {
      setInternalSelectedDate(dateString);
    }
  };

  return (
    <View className="w-full rounded-3xl bg-[#899064]" style={{ flex: 1 }}>
      <View className="mb-3 flex-row items-center justify-between px-1">
        <Pressable
          onPress={handlePrevAllowedMonth}
          hitSlop={10}
          accessibilityLabel="Mes anterior"
          disabled={hasAllowedMonths ? currentMonthIndex <= 0 : false}>
          <Text className="text-lg" style={{ color: DAY_TEXT }}>
            {'<'}
          </Text>
        </Pressable>
        <Text className="font-inter-bold text-lg" style={{ color: DAY_TEXT }}>
          {monthLabel}
        </Text>
        <Pressable
          onPress={handleNextAllowedMonth}
          hitSlop={10}
          accessibilityLabel="Mes siguiente"
          disabled={hasAllowedMonths ? currentMonthIndex >= allowedMonthKeys.length - 1 : false}>
          <Text className="text-lg" style={{ color: DAY_TEXT }}>
            {'>'}
          </Text>
        </Pressable>
      </View>

      <View className="mb-2 flex-row justify-between px-1">
        {WEEKDAYS.map((label, index) => (
          <Text
            key={`${label}-${index}`}
            style={{ width: daySize, textAlign: 'center', color: DAY_TEXT }}
            className="font-inter-semibold text-base">
            {label}
          </Text>
        ))}
      </View>

      <ScrollView
        style={{ height: viewportHeight }}
        contentContainerStyle={{ paddingBottom: 4 }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        <RNCalendar
          style={{ minHeight }}
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
          hideDayNames
          hideArrows
          renderHeader={() => null}
          disableAllTouchEventsForInactiveDays
          theme={calendarTheme}
        />
      </ScrollView>
    </View>
  );
}
