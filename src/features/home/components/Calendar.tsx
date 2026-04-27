import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ShadowSurface } from '@/components';
import type { CalendarProps } from '../types/calendar';
import { formatDateKey, isSelectableDate, startOfDay } from '../utils/calendarDate';

const DAY_TEXT = '#2C2F1D';
const DISABLED_TEXT = 'rgba(44, 47, 29, 0.45)';
const SELECTED_BG = '#364025';
const SELECTED_TEXT = '#F5F3D4';
const PLANNED_BG = '#FFB63C';
const DEFAULT_DAY_SIZE = 42;
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

type MonthGridCell = {
  date: Date;
  isCurrentMonth: boolean;
};

function getMonthGrid(year: number, month: number): MonthGridCell[] {
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + totalDays) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - firstDay + 1;
    const cellDate = new Date(year, month, dayNumber);
    return {
      date: cellDate,
      isCurrentMonth: dayNumber > 0 && dayNumber <= totalDays,
    };
  });
}

export function Calendar({
  planByDate = {},
  selectedDate,
  onSelectDate,
  daySize = DEFAULT_DAY_SIZE,
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
  const isPrevDisabled = hasAllowedMonths ? currentMonthIndex <= 0 : false;
  const isNextDisabled = hasAllowedMonths
    ? currentMonthIndex >= allowedMonthKeys.length - 1
    : false;

  useEffect(() => {
    if (!hasAllowedMonths) {
      return;
    }

    if (currentMonthIndex === -1) {
      setCurrentMonth(parseMonthKey(allowedMonthKeys[0]));
    }
  }, [allowedMonthKeys, currentMonthIndex, hasAllowedMonths]);

  const monthGrid = useMemo(() => getMonthGrid(year, month), [year, month]);
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
    if (!isSelectableDate(dateString, planByDate, today)) {
      return;
    }

    onSelectDate?.(dateString);
    if (selectedDate === undefined) {
      setInternalSelectedDate(dateString);
    }
  };

  return (
    <ShadowSurface
      className="w-full rounded-3xl bg-[#899064]"
      style={{ flex: 1, borderRadius: 24 }}>
      <View className="w-full overflow-hidden rounded-3xl" style={{ flex: 1 }}>
        <View className="mb-3 flex-row items-center justify-center gap-6 px-1">
          <Pressable
            onPress={handlePrevAllowedMonth}
            hitSlop={10}
            accessibilityLabel="Mes anterior"
            disabled={isPrevDisabled}
            style={{ opacity: isPrevDisabled ? 0.35 : 1 }}>
            <Text className="text-xl" style={{ color: DAY_TEXT }}>
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
            disabled={isNextDisabled}
            style={{ opacity: isNextDisabled ? 0.35 : 1 }}>
            <Text className="text-xl" style={{ color: DAY_TEXT }}>
              {'>'}
            </Text>
          </Pressable>
        </View>

        <View className="mb-2 flex-row px-1">
          {WEEKDAYS.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              style={{ width: '14.2857%', textAlign: 'center', color: DAY_TEXT }}
              className="font-inter-semibold text-base">
              {label}
            </Text>
          ))}
        </View>
        <View className="h-px w-full bg-[#364025] opacity-30" />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 0, flexGrow: 0 }}
          showsVerticalScrollIndicator={false}
          bounces={true}
          alwaysBounceVertical={false}
          nestedScrollEnabled>
          <View className="flex-row flex-wrap px-1 pt-2">
            {monthGrid.map((cell) => {
              const dayDate = cell.date;
              const dateString = formatDateKey(dayDate);
              const isPreviousMonthDay =
                dayDate.getFullYear() < year ||
                (dayDate.getFullYear() === year && dayDate.getMonth() < month);
              const isSelectable =
                !isPreviousMonthDay && isSelectableDate(dateString, planByDate, today);
              const isSelected = activeSelectedDate === dateString;
              const isToday = dateString === todayKey;
              const isPlanned = Boolean(planByDate[dateString]?.length);
              const hasCircle = isSelected || isToday || isPlanned;
              const borderColor = !isSelected && isToday ? SELECTED_BG : 'transparent';
              const borderWidth = !isSelected && isToday ? 2 : 0;
              const backgroundColor = isSelected
                ? SELECTED_BG
                : isPlanned
                  ? PLANNED_BG
                  : 'transparent';
              const textColor = isSelected
                ? SELECTED_TEXT
                : isSelectable
                  ? DAY_TEXT
                  : DISABLED_TEXT;

              return (
                <View
                  key={dateString}
                  style={{ width: '14.2857%', alignItems: 'center', marginBottom: 8 }}>
                  <Pressable
                    onPress={() => handleSelectDate(dateString)}
                    disabled={!isSelectable}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !isSelectable }}
                    style={{
                      width: daySize,
                      height: daySize,
                      borderRadius: hasCircle ? daySize / 2 : 0,
                      borderColor: borderColor,
                      borderWidth: borderWidth,
                      backgroundColor,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Text style={{ color: textColor }} className="font-inter-semibold text-base">
                      {dayDate.getDate()}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ShadowSurface>
  );
}
