import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import type { CalendarProps } from '../types/calendar';
import { formatDateKey, isSelectableDate, startOfDay } from '../utils/calendarDate';

const DAY_TEXT = '#2C2F1D';
const DISABLED_TEXT = 'rgba(44, 47, 29, 0.45)';
const SELECTED_TEXT = '#2C2F1D';
const DEFAULT_DAY_SIZE = 42;
const DEFAULT_MONTH_FONT_SIZE = 18;
const DEFAULT_NAV_FONT_SIZE = 20;
const DEFAULT_WEEKDAY_FONT_SIZE = 14;
const DEFAULT_DAY_FONT_SIZE = 14;
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

const ACTIVE_BG = 'rgba(255, 182, 60, 0.65)';
const ACTIVE_BORDER = 'rgba(255, 182, 60, 0.80)';

const INACTIVE_BG = 'rgba(216, 217, 139, 0.50)';
const INACTIVE_BORDER = 'rgba(216, 217, 139, 0.75)';

const TODAY_BG = 'rgba(124, 125, 79, 0.50)';
const TODAY_BORDER = 'rgba(36, 43, 18, 0.70)';

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

const DayCell = ({
  dayDate,
  dateString,
  isSelectable,
  isSelected,
  isToday,
  isPlanned,
  daySize,
  dayFontSize,
  textColor,
  onSelect,
}: any) => {
  const textScale = useSharedValue(1);
  const circleScale = useSharedValue(1);

  const getColors = () => {
    if (isSelected) return { bg: ACTIVE_BG, border: ACTIVE_BORDER, borderWidth: 1 };
    if (isToday) return { bg: TODAY_BG, border: TODAY_BORDER, borderWidth: 1 };
    if (isPlanned) return { bg: INACTIVE_BG, border: INACTIVE_BORDER, borderWidth: 1 };
    return { bg: 'transparent', border: 'transparent', borderWidth: 0 };
  };

  const colors = getColors();

  useEffect(() => {
    if (isSelected) {
      textScale.value = withTiming(1.05, { duration: 250, easing: Easing.out(Easing.quad) });
      
      // Animación rápida de agrandar y achicar para el círculo (efecto pop sin rebote)
      circleScale.value = withSequence(
        withTiming(1.15, { duration: 100, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 100, easing: Easing.in(Easing.quad) })
      );
    } else {
      textScale.value = withTiming(1, { duration: 200, easing: Easing.in(Easing.quad) });
      circleScale.value = withTiming(1, { duration: 150 });
    }
  }, [isSelected, textScale, circleScale]);

  const animatedCircleStyle = useAnimatedStyle(() => {
    // Transición directa de colores (sin opacidad animada) y animación de escala
    return {
      backgroundColor: colors.bg,
      borderColor: colors.border,
      borderWidth: colors.borderWidth,
      transform: [{ scale: circleScale.value }],
    };
  });

  const animatedTextStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: textScale.value }],
    };
  });

  return (
    <View style={{ width: '14.2857%', alignItems: 'center', marginBottom: 8, zIndex: 1 }}>
      <Pressable
        onPress={() => onSelect(dateString)}
        disabled={!isSelectable}
        accessibilityRole="button"
        accessibilityState={{ disabled: !isSelectable }}>
        <Animated.View
          style={[
            {
              width: daySize,
              height: daySize,
              borderRadius: daySize / 2,
              alignItems: 'center',
              justifyContent: 'center',
            },
            animatedCircleStyle,
          ]}>
          <Animated.Text
            style={[
              { color: textColor, fontSize: dayFontSize },
              animatedTextStyle,
            ]}
            className="font-inter-semibold">
            {dayDate.getDate()}
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </View>
  );
};

export function Calendar({
  planByDate = {},
  selectedDate,
  onSelectDate,
  daySize = DEFAULT_DAY_SIZE,
  monthFontSize = DEFAULT_MONTH_FONT_SIZE,
  navFontSize = DEFAULT_NAV_FONT_SIZE,
  weekdayFontSize = DEFAULT_WEEKDAY_FONT_SIZE,
  dayFontSize = DEFAULT_DAY_FONT_SIZE,
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
      className="w-full rounded-3xl bg-[#899064] opacity-90"
      style={{ flex: 1, borderRadius: 24 }}>
      <View className="w-full overflow-hidden rounded-3xl" style={{ flex: 1 }}>
        <View className="mb-3 flex-row items-center justify-center gap-6 px-1">
          <Pressable
            onPress={handlePrevAllowedMonth}
            hitSlop={10}
            accessibilityLabel="Mes anterior"
            disabled={isPrevDisabled}
            style={{ opacity: isPrevDisabled ? 0.35 : 1 }}>
            <Text style={{ color: DAY_TEXT, fontSize: navFontSize }}>{'<'}</Text>
          </Pressable>
          <Text className="font-inter-bold" style={{ color: DAY_TEXT, fontSize: monthFontSize }}>
            {monthLabel}
          </Text>
          <Pressable
            onPress={handleNextAllowedMonth}
            hitSlop={10}
            accessibilityLabel="Mes siguiente"
            disabled={isNextDisabled}
            style={{ opacity: isNextDisabled ? 0.35 : 1 }}>
            <Text style={{ color: DAY_TEXT, fontSize: navFontSize }}>{'>'}</Text>
          </Pressable>
        </View>

        <View className="mb-2 flex-row px-1">
          {WEEKDAYS.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              style={{
                width: '14.2857%',
                textAlign: 'center',
                color: DAY_TEXT,
                fontSize: weekdayFontSize,
              }}
              className="font-inter-semibold">
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
          <View className="relative flex-row flex-wrap px-1 pt-2">
            {monthGrid.map((cell) => {
              const dayDate = cell.date;
              const dateString = formatDateKey(dayDate);
              const isSelectable = isSelectableDate(dateString, planByDate, today);
              const isSelected = activeSelectedDate === dateString;
              const isToday = dateString === todayKey;
              const isPlanned = Boolean(planByDate[dateString]?.length);

              const textColor = isSelected
                ? SELECTED_TEXT
                : isSelectable
                  ? DAY_TEXT
                  : DISABLED_TEXT;

              return (
                <DayCell
                  key={dateString}
                  dayDate={dayDate}
                  dateString={dateString}
                  isSelectable={isSelectable}
                  isSelected={isSelected}
                  isToday={isToday}
                  isPlanned={isPlanned}
                  daySize={daySize}
                  dayFontSize={dayFontSize}
                  textColor={textColor}
                  onSelect={handleSelectDate}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({});
