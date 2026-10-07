import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Calendar } from './Calendar';
import type { CalendarProps } from '../types/calendar';
import {
  getFloatingCalendarFrame,
  type FloatingCalendarAnchor,
} from '../utils/floatingCalendarPosition';

const ENTER_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) };
const EXIT_TIMING = { duration: 140, easing: Easing.in(Easing.cubic) };
// How far above its place the calendar starts, and ends, its fade.
const ENTER_OFFSET = 8;

// Smaller than the Home calendar, which has half a screen: this one floats over another screen.
const COMPACT_SIZES = {
  daySize: 36,
  monthFontSize: 16,
  navFontSize: 18,
  weekdayFontSize: 12,
  dayFontSize: 13,
};

export type FloatingCalendarProps = Omit<CalendarProps, 'sizing'> & {
  // Window frame of the element the calendar opens under. The calendar is open while it has one.
  anchor: FloatingCalendarAnchor | null;
  // A tap outside, or the Android back button. Picking a day does not close: the caller decides.
  onClose: () => void;
};

// The caller's half of the anchoring. `anchorRef` goes on the element that opens the calendar,
// a View with `collapsable={false}` so Android keeps it measurable; `open` goes on its press and
// `anchor` and `close` go to `FloatingCalendar`.
export function useFloatingCalendarAnchor() {
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<FloatingCalendarAnchor | null>(null);

  const open = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  }, []);

  const close = useCallback(() => {
    setAnchor(null);
  }, []);

  return { anchorRef, anchor, open, close };
}

// The Home calendar in a popover: over everything, right under the element that opens it.
export function FloatingCalendar({ anchor, onClose, ...calendarProps }: FloatingCalendarProps) {
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const isOpen = anchor !== null;
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [shownAnchor, setShownAnchor] = useState(anchor);

  // The calendar outlives its anchor by one fade: it leaves from where it was.
  if (anchor !== null && anchor !== shownAnchor) {
    setShownAnchor(anchor);
  }

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setIsClosing(!isOpen && !reduceMotion);
  }

  useEffect(() => {
    if (isOpen) {
      progress.set(reduceMotion ? 1 : withTiming(1, ENTER_TIMING));
      return;
    }

    if (!isClosing) {
      progress.set(0);
      return;
    }

    progress.set(
      withTiming(0, EXIT_TIMING, (finished) => {
        // Opening again replaces this animation, which then ends unfinished.
        if (finished) scheduleOnRN(setIsClosing, false);
      })
    );
  }, [isClosing, isOpen, progress, reduceMotion]);

  const motionStyle = useAnimatedStyle(() => {
    const shown = progress.get();

    return { opacity: shown, transform: [{ translateY: (shown - 1) * ENTER_OFFSET }] };
  });

  return (
    <Modal
      animationType="none"
      transparent
      visible={isOpen || isClosing}
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.screen}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        {/* Sibling of the backdrop pressable, so a press on the calendar never closes it. */}
        {shownAnchor ? (
          <Animated.View
            accessibilityViewIsModal
            role="dialog"
            // A day pressed during the fade out would be picked after the calendar closed.
            pointerEvents={isOpen ? 'auto' : 'none'}
            style={[
              styles.popover,
              getFloatingCalendarFrame(shownAnchor, windowWidth),
              motionStyle,
            ]}>
            <Calendar {...COMPACT_SIZES} {...calendarProps} sizing="content" />
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  popover: {
    position: 'absolute',
  },
  screen: {
    flex: 1,
  },
});
