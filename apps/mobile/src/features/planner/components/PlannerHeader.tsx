import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Calendar, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { FloatingCalendar, isRangeComplete, useFloatingCalendarAnchor } from '@/features/home';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPlanningRangeButtonLabel, formatPlanningRangeLabel } from '../domain/planningRange';
import type { usePlanningRange } from '../hooks/usePlanningRange';

interface PlannerHeaderProps {
  /** The range the pill shows and its calendar picks; the screen reads it to start planning. */
  planningRange: ReturnType<typeof usePlanningRange>;
}

export function PlannerHeader({ planningRange }: PlannerHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const { range, planByDate, isDateSelectable, monthBounds, selectDate } = planningRange;
  const { anchorRef, anchor, open, close } = useFloatingCalendarAnchor();
  const pillBackgroundStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorBlack });
  const pillLabelStyle = useAnimatedThemeStyle({ color: theme.primaryAccent });

  // The calendar stays open until the range has both ends: the first tap only sets the start.
  const handleSelectDate = (dateKey: string) => {
    if (isRangeComplete(selectDate(dateKey))) close();
  };

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
      <Pressable
        ref={anchorRef}
        // The calendar is placed from the frame of this view: Android must not flatten it.
        collapsable={false}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={formatPlanningRangeButtonLabel(range)}
        accessibilityState={{ expanded: anchor !== null }}
        style={({ pressed }) => [
          styles.datePill,
          styles.shadow,
          // The view that casts the shadow needs a fill of its own: Android draws no
          // elevation shadow for a view without a background.
          { backgroundColor: theme.colorBlack, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}>
        {/* Over that fill, the layer that crossfades when the palette changes. */}
        <Animated.View pointerEvents="none" style={[styles.datePillFill, pillBackgroundStyle]} />
        <Calendar size={20} color={theme.primaryAccent} strokeWidth={2.5} />
        <Animated.Text style={[styles.dateLabel, pillLabelStyle]}>
          {formatPlanningRangeLabel(range)}
        </Animated.Text>
      </Pressable>
      <Pressable
        onPress={() => router.back()}
        style={[styles.closeButton, styles.shadow, { backgroundColor: theme.colorBlack }]}>
        <Check size={24} color={theme.primaryAccent} strokeWidth={2.5} />
      </Pressable>
      {/* A tap outside closes it with whatever is selected: a start alone waits for its end. */}
      <FloatingCalendar
        anchor={anchor}
        onClose={close}
        planByDate={planByDate}
        isDateSelectable={isDateSelectable}
        monthBounds={monthBounds}
        rangeStart={range.start}
        rangeEnd={range.end}
        onSelectDate={handleSelectDate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    borderRadius: 9999,
    padding: 10.5,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.35,
    lineHeight: 21,
  },
  datePill: {
    alignItems: 'center',
    borderRadius: 9999,
    flexDirection: 'row',
    gap: 10.5,
    paddingHorizontal: 17.5,
    paddingVertical: 10.5,
  },
  datePillFill: {
    borderRadius: 9999,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    zIndex: 10,
  },
  shadow: {
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});
