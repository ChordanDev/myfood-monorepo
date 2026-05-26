import { Pressable, ScrollView, Text, View } from 'react-native';
import { ShadowSurface } from '@/components';
import { DayCell } from './DayCell';
import { useCalendarState } from '../hooks/useCalendarState';
import { CALENDAR_DEFAULTS, MONTHS, WEEKDAYS } from '../constants/calendar';
import { formatDateKey, isSelectableDate } from '../utils/calendarDate';
import type { CalendarProps } from '../types/calendar';

import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useThemeColor } from '@/hooks/useThemeColor';

export function Calendar({
  planByDate = {},
  selectedDate,
  onSelectDate,
  daySize = CALENDAR_DEFAULTS.daySize,
  monthFontSize = CALENDAR_DEFAULTS.monthFontSize,
  navFontSize = CALENDAR_DEFAULTS.navFontSize,
  weekdayFontSize = CALENDAR_DEFAULTS.weekdayFontSize,
  dayFontSize = CALENDAR_DEFAULTS.dayFontSize,
}: CalendarProps) {
  const { theme } = useRecipeTheme();
  const { getColorWithOpacity } = useThemeColor();
  const {
    year,
    month,
    today,
    todayKey,
    activeSelectedDate,
    monthGrid,
    isPrevDisabled,
    isNextDisabled,
    handlePrevMonth,
    handleNextMonth,
    handleSelectDate,
  } = useCalendarState(planByDate, selectedDate, onSelectDate);

  const monthLabel = `${MONTHS[month]} ${year}`;

  return (
    <ShadowSurface
      className="w-full rounded-3xl"
      style={{ flex: 1, borderRadius: 24, backgroundColor: theme.colorLight }}>
      <View className="w-full overflow-hidden rounded-3xl" style={{ flex: 1 }}>
        <View className="mb-3 flex-row items-center justify-center gap-6 px-1">
          <Pressable
            onPress={handlePrevMonth}
            hitSlop={10}
            accessibilityLabel="Mes anterior"
            disabled={isPrevDisabled}
            style={{ opacity: isPrevDisabled ? 0.35 : 1 }}>
            <Text style={{ color: theme.textDark, fontSize: navFontSize }}>{'<'}</Text>
          </Pressable>
          <Text
            className="font-inter-bold"
            style={{ color: theme.textDark, fontSize: monthFontSize }}>
            {monthLabel}
          </Text>
          <Pressable
            onPress={handleNextMonth}
            hitSlop={10}
            accessibilityLabel="Mes siguiente"
            disabled={isNextDisabled}
            style={{ opacity: isNextDisabled ? 0.35 : 1 }}>
            <Text style={{ color: theme.textDark, fontSize: navFontSize }}>{'>'}</Text>
          </Pressable>
        </View>

        <View className="mb-2 flex-row px-1">
          {WEEKDAYS.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              style={{
                width: '14.2857%',
                textAlign: 'center',
                color: theme.textDark,
                fontSize: weekdayFontSize,
              }}
              className="font-inter-semibold">
              {label}
            </Text>
          ))}
        </View>
        <View className="h-px w-full opacity-30" style={{ backgroundColor: theme.colorDark }} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
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
                ? theme.textBlack
                : isSelectable
                  ? theme.textBlack
                  : getColorWithOpacity('textBlack', 0.45);

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
