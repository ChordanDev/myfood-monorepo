import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { DayCell } from './DayCell';
import { useCalendarState } from '../hooks/useCalendarState';
import { CALENDAR_DEFAULTS, MONTHS, WEEKDAYS } from '../constants/calendar';
import { formatDateKey, isSelectableDate } from '../utils/calendarDate';
import type { CalendarProps } from '../types/calendar';

import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

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
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const textDarkStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const dividerStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <View style={styles.header}>
          <Pressable
            onPress={handlePrevMonth}
            hitSlop={10}
            accessibilityLabel="Mes anterior"
            disabled={isPrevDisabled}
            style={{ opacity: isPrevDisabled ? 0.35 : 1 }}>
            <Animated.Text style={[{ fontSize: navFontSize }, textDarkStyle]}>{'<'}</Animated.Text>
          </Pressable>
          <Animated.Text style={[styles.monthLabel, { fontSize: monthFontSize }, textDarkStyle]}>
            {monthLabel}
          </Animated.Text>
          <Pressable
            onPress={handleNextMonth}
            hitSlop={10}
            accessibilityLabel="Mes siguiente"
            disabled={isNextDisabled}
            style={{ opacity: isNextDisabled ? 0.35 : 1 }}>
            <Animated.Text style={[{ fontSize: navFontSize }, textDarkStyle]}>{'>'}</Animated.Text>
          </Pressable>
        </View>

        <View style={styles.weekdays}>
          {WEEKDAYS.map((label, index) => (
            <Animated.Text
              key={`${label}-${index}`}
              style={[
                {
                  width: '14.2857%',
                  textAlign: 'center',
                  fontSize: weekdayFontSize,
                },
                textDarkStyle,
                styles.weekdayLabel,
              ]}>
              {label}
            </Animated.Text>
          ))}
        </View>
        <Animated.View style={[styles.divider, dividerStyle]} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          bounces={true}
          alwaysBounceVertical={false}
          nestedScrollEnabled>
          <View style={styles.monthGrid}>
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
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
    opacity: 0.3,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 21,
    justifyContent: 'center',
    marginBottom: 10.5,
    paddingHorizontal: 3.5,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 3.5,
    paddingTop: 7,
    position: 'relative',
  },
  monthLabel: {
    fontFamily: 'Inter_700Bold',
  },
  shadowSurface: {
    borderRadius: 24,
    flex: 1,
    width: '100%',
  },
  surface: {
    borderRadius: 21,
    flex: 1,
    overflow: 'hidden',
    width: '100%',
  },
  weekdayLabel: {
    fontFamily: 'Inter_600SemiBold',
  },
  weekdays: {
    flexDirection: 'row',
    marginBottom: 7,
    paddingHorizontal: 3.5,
  },
});
