import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Calendar } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { FloatingCalendar, useFloatingCalendarAnchor } from '@/features/home';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { formatUntilButtonLabel } from '../domain';
import type { ShoppingUntilCalendar } from '../types';

const PILL_RADIUS = 9999;

export interface ShoppingDatePillProps {
  label: string;
  // Day the list reaches: the one the calendar shows as selected.
  untilDate: string;
  // The days that can be picked, their marks and their months. Without one there is no day
  // to pick, and the pill only shows the date.
  calendar: ShoppingUntilCalendar | undefined;
  onSelectDate: (dateKey: string) => void;
}

// What the pill looks like, with or without a calendar behind it.
function PillFace({ label }: Pick<ShoppingDatePillProps, 'label'>) {
  const { theme } = useRecipeTheme();
  const backgroundStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorBlack });
  const labelStyle = useAnimatedThemeStyle({ color: theme.primaryAccent });

  return (
    <ShadowSurface style={styles.pill}>
      {/* The palette-animated fill is its own layer so the shadow wrapper stays a plain View. */}
      <Animated.View pointerEvents="none" style={[styles.background, backgroundStyle]} />
      <Calendar size={20} color={theme.primaryAccent} strokeWidth={2.5} />
      <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text>
    </ShadowSurface>
  );
}

type PickerPillProps = ShoppingDatePillProps & { calendar: ShoppingUntilCalendar };

// The pill as a button, and the calendar it opens right under itself.
function PickerPill({ label, untilDate, calendar, onSelectDate }: PickerPillProps) {
  const { anchorRef, anchor, open, close } = useFloatingCalendarAnchor();

  // One pick is the whole errand: the day is reported and the calendar leaves.
  const handleSelectDate = (dateKey: string) => {
    onSelectDate(dateKey);
    close();
  };

  return (
    <>
      <Pressable
        ref={anchorRef}
        // The calendar is placed from the frame of this view: Android must not flatten it.
        collapsable={false}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={formatUntilButtonLabel(untilDate)}
        accessibilityState={{ expanded: anchor !== null }}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <PillFace label={label} />
      </Pressable>
      <FloatingCalendar
        anchor={anchor}
        onClose={close}
        planByDate={calendar.planByDate}
        isDateSelectable={calendar.isDateSelectable}
        monthBounds={calendar.monthBounds}
        selectedDate={untilDate}
        onSelectDate={handleSelectDate}
      />
    </>
  );
}

// Shows the last day the list buys for and, while there is a day to pick, opens the calendar
// that changes it. The pill owns the calendar, so the screen only hands it the day and the
// rules.
export function ShoppingDatePill({ calendar, ...pill }: ShoppingDatePillProps) {
  if (!calendar) return <PillFace label={pill.label} />;

  return <PickerPill {...pill} calendar={calendar} />;
}

const styles = StyleSheet.create({
  background: {
    borderRadius: PILL_RADIUS,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    letterSpacing: 0.35,
    lineHeight: 21,
  },
  pill: {
    alignItems: 'center',
    borderRadius: PILL_RADIUS,
    flexDirection: 'row',
    gap: 10.5,
    paddingHorizontal: 17.5,
    paddingVertical: 10.5,
    // Softer than the default surface shadow: the one the Planner header pill casts.
    elevation: 4,
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});
