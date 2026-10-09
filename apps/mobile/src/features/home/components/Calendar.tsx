import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { DayCell } from './DayCell';
import { useCalendarState } from '../hooks/useCalendarState';
import {
  CALENDAR_DEFAULTS,
  DAY_ROW_GAP,
  MAX_WEEK_ROWS,
  MONTHS,
  WEEKDAYS,
} from '../constants/calendar';
import { formatDateKey, isPendingDate } from '../utils/calendarDate';
import { isBetweenRangeEdges, isRangeEdge } from '../utils/calendarRange';
import type { CalendarProps } from '../types/calendar';

import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

export function Calendar({
  planByDate = {},
  markedDates,
  selectedDate,
  onSelectDate,
  isDateSelectable,
  monthBounds,
  rangeStart,
  rangeEnd,
  sizing = 'fill',
  daySize = CALENDAR_DEFAULTS.daySize,
  monthFontSize = CALENDAR_DEFAULTS.monthFontSize,
  navFontSize = CALENDAR_DEFAULTS.navFontSize,
  weekdayFontSize = CALENDAR_DEFAULTS.weekdayFontSize,
  dayFontSize = CALENDAR_DEFAULTS.dayFontSize,
}: CalendarProps) {
  const { theme } = useRecipeTheme();
  const { getColorWithOpacity } = useThemeColor();
  // A caller that draws a range owns the selection: the calendar keeps no selected day of its own.
  const hasRange = rangeStart !== undefined;
  const controlledSelectedDate = hasRange && selectedDate === undefined ? null : selectedDate;
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
    canSelectDate,
  } = useCalendarState(planByDate, controlledSelectedDate, onSelectDate, {
    isDateSelectable,
    monthBounds,
  });

  const monthLabel = `${MONTHS[month]} ${year}`;
  const range = { start: rangeStart ?? null, end: rangeEnd ?? null };
  const fitsContent = sizing === 'content';
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const textDarkStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const dividerStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });

  const monthGridView = (
    <View
      style={[
        styles.monthGrid,
        // Room for the longest month, so a surface sized to its content keeps one height.
        fitsContent && { minHeight: GRID_PADDING_TOP + MAX_WEEK_ROWS * (daySize + DAY_ROW_GAP) },
      ]}>
      {monthGrid.map((cell) => {
        const dayDate = cell.date;
        const dateString = formatDateKey(dayDate);
        const isSelectable = canSelectDate(dateString);
        // An end of the range reads like the selected day; the days between them are tinted.
        const isSelected = activeSelectedDate === dateString || isRangeEdge(dateString, range);
        const isInRange = isBetweenRangeEdges(dateString, range);
        const isToday = dateString === todayKey;
        const isPendingConfirmation = isPendingDate(dateString, planByDate, today);
        // A past day with nothing left to confirm reads like a day without a plan.
        const isSettledPastDay = dayDate < today && !isPendingConfirmation;
        // Marks handed in from outside are taken as they are: their caller decides which days
        // are planned, past ones included.
        const isPlanned = markedDates
          ? markedDates.includes(dateString)
          : Boolean(planByDate[dateString]?.length) && !isSettledPastDay;

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
            isInRange={isInRange}
            isToday={isToday}
            isPlanned={isPlanned}
            isPendingConfirmation={isPendingConfirmation}
            daySize={daySize}
            dayFontSize={dayFontSize}
            textColor={textColor}
            onSelect={handleSelectDate}
          />
        );
      })}
    </View>
  );

  return (
    <ShadowSurface style={[styles.shadowSurface, !fitsContent && styles.fill]}>
      <Animated.View
        style={[styles.surface, fitsContent ? styles.surfaceContent : styles.fill, surfaceStyle]}>
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
        {fitsContent ? (
          monthGridView
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            bounces={true}
            alwaysBounceVertical={false}
            nestedScrollEnabled>
            {monthGridView}
          </ScrollView>
        )}
      </Animated.View>
    </ShadowSurface>
  );
}

const GRID_PADDING_TOP = 7;

const styles = StyleSheet.create({
  divider: {
    height: 1,
    opacity: 0.3,
    width: '100%',
  },
  fill: {
    flex: 1,
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
    paddingTop: GRID_PADDING_TOP,
    position: 'relative',
  },
  monthLabel: {
    fontFamily: 'Inter_700Bold',
  },
  shadowSurface: {
    borderRadius: 24,
    width: '100%',
  },
  surface: {
    borderRadius: 21,
    overflow: 'hidden',
    width: '100%',
  },
  // Without a parent to fill, the surface keeps its own air around the month.
  surfaceContent: {
    paddingBottom: 6,
    paddingHorizontal: 10,
    paddingTop: 14,
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
