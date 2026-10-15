import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import {
  CALENDAR_DOT_SLOTS,
  DAY_ROW_GAP,
  SLOT_DOT_GAP,
  SLOT_DOT_ROW_HEIGHT,
  SLOT_DOT_SIZE,
} from '../constants/calendar';
import { describeDayForAccessibility } from '../domain/calendarPlan';
import type { HomeMealSlot } from '../domain/localMealPlan';

// Fill of a day between the two ends of a range: the selection token, lighter than an end.
const IN_RANGE_FILL_OPACITY = 0.3;

export interface DayCellProps {
  dayDate: Date;
  dateString: string;
  isSelectable: boolean;
  isSelected: boolean;
  // Strictly between the two ends of a range. The ends themselves arrive as selected.
  isInRange?: boolean;
  isToday: boolean;
  isPlanned: boolean;
  // The slots of the day that hold a Scheduled meal. Without it the day draws no slot dots.
  plannedSlots?: HomeMealSlot[];
  isPendingConfirmation: boolean;
  daySize: number;
  dayFontSize: number;
  textColor: string;
  onSelect: (dateString: string) => void;
}

// A slot's dot: filled with the accent when the slot is planned, its outline when it is free.
function SlotDot({ slot, isPlanned }: { slot: HomeMealSlot; isPlanned: boolean }) {
  const { theme } = useRecipeTheme();
  const dotStyle = useAnimatedThemeStyle({
    backgroundColor: isPlanned ? theme.primaryAccent : 'transparent',
    borderColor: theme.primaryAccent,
  });

  return <Animated.View testID={`slot-dot-${slot}`} style={[styles.slotDot, dotStyle]} />;
}

export const DayCell = memo(
  ({
    dayDate,
    dateString,
    isSelectable,
    isSelected,
    isInRange = false,
    isToday,
    isPlanned,
    plannedSlots,
    isPendingConfirmation,
    daySize,
    dayFontSize,
    textColor,
    onSelect,
  }: DayCellProps) => {
    const { theme } = useRecipeTheme();

    const colors = useMemo(() => {
      const targetOpacity = 0.7;
      // A pending day is always in the past, so it never overlaps with today.
      if (isPendingConfirmation) {
        return {
          bg: withOpacity(theme.alert, targetOpacity),
          border: isSelected ? theme.colorMedium : theme.alert,
          borderWidth: isSelected ? 2 : 1,
        };
      }

      if (isSelected) {
        if (isToday) {
          return {
            bg: withOpacity(theme.primaryAccent, targetOpacity),
            border: theme.colorMedium,
            borderWidth: 2,
          };
        }
        return {
          bg: withOpacity(theme.primaryAccent, targetOpacity),
          border: theme.primaryAccent,
          borderWidth: 1,
        };
      }

      if (isInRange) {
        // The fill says the day is inside the range; the outline keeps saying what it already was.
        const outline = isToday ? theme.colorMedium : isPlanned ? theme.icon : null;

        return {
          bg: withOpacity(theme.primaryAccent, IN_RANGE_FILL_OPACITY),
          border: outline ?? withOpacity(theme.primaryAccent, 0),
          borderWidth: outline ? 1 : 0,
        };
      }

      if (isToday) {
        return {
          bg: withOpacity(theme.icon, targetOpacity),
          border: theme.colorMedium,
          borderWidth: 1,
        };
      }

      if (isPlanned) {
        return {
          bg: withOpacity(theme.icon, targetOpacity),
          border: theme.icon,
          borderWidth: 1,
        };
      }

      return { bg: 'transparent', border: 'transparent', borderWidth: 0 };
    }, [isSelected, isInRange, isToday, isPlanned, isPendingConfirmation, theme]);
    const selectionStateKey = `${isSelected}-${isInRange}-${isToday}-${isPlanned}-${isSelectable}-${isPendingConfirmation}`;
    const dayNumber = dayDate.getDate();
    const circleStyle = useAnimatedThemeStyle(
      {
        backgroundColor: colors.bg,
        borderColor: colors.border,
      },
      { immediateKey: selectionStateKey }
    );
    const textStyle = useAnimatedThemeStyle(
      { color: textColor },
      { immediateKey: selectionStateKey }
    );

    return (
      <View
        style={{ width: '14.2857%', alignItems: 'center', marginBottom: DAY_ROW_GAP, zIndex: 1 }}>
        <Pressable
          onPress={() => {
            if (!isSelected) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            onSelect(dateString);
          }}
          hitSlop={8}
          disabled={!isSelectable}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
          accessibilityRole="button"
          accessibilityLabel={
            isPendingConfirmation
              ? `${dayNumber}, comida sin confirmar`
              : plannedSlots && describeDayForAccessibility(dayDate, plannedSlots)
          }
          accessibilityState={{ disabled: !isSelectable }}>
          <Animated.View
            style={[
              {
                width: daySize,
                height: daySize,
                borderRadius: daySize / 2,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: colors.borderWidth,
              },
              circleStyle,
            ]}>
            <Animated.Text style={[styles.dayText, { fontSize: dayFontSize }, textStyle]}>
              {isPendingConfirmation ? '!' : dayNumber}
            </Animated.Text>
          </Animated.View>
          {plannedSlots && (
            <View style={styles.slotDots}>
              {CALENDAR_DOT_SLOTS.map((slot) => (
                <SlotDot key={slot} slot={slot} isPlanned={plannedSlots.includes(slot)} />
              ))}
            </View>
          )}
        </Pressable>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  dayText: {
    fontFamily: 'Inter_600SemiBold',
  },
  slotDot: {
    borderRadius: SLOT_DOT_SIZE / 2,
    borderWidth: 1,
    height: SLOT_DOT_SIZE,
    width: SLOT_DOT_SIZE,
  },
  slotDots: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: SLOT_DOT_GAP,
    height: SLOT_DOT_ROW_HEIGHT,
    justifyContent: 'center',
  },
});
