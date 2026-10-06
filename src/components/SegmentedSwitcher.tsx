import { useEffect, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ShadowSurface } from './ShadowSurface';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';

export interface SegmentedSwitcherOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedSwitcherProps<T extends string | number> {
  /** Two or more options, rendered left to right with equal widths. */
  options: SegmentedSwitcherOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Applied to the outer container, e.g. `{ flex: 1 }` to fill a header row. */
  style?: StyleProp<ViewStyle>;
}

interface OptionLayout {
  x: number;
  width: number;
  height: number;
}

const CONTAINER_PADDING = 5;
const CONTAINER_RADIUS = 24;
const INDICATOR_RADIUS = 20;
// The pill is slightly narrower than its option and centred on it.
const INDICATOR_WIDTH_RATIO = 0.92;
const INDICATOR_FADE_DURATION = 200;
const INDICATOR_SLIDE_CONFIG = { duration: 300, easing: Easing.out(Easing.quad) };
// A label that does not fit its option shrinks down to this scale before it is cut.
const LABEL_MIN_FONT_SCALE = 0.8;

interface SwitcherOptionProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}

function SwitcherOption({ label, isSelected, onPress, onLayout }: SwitcherOptionProps) {
  const { theme } = useRecipeTheme();
  const labelThemeStyle = useAnimatedThemeStyle({
    color: isSelected ? theme.textMedium : theme.textLight,
  });

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      style={styles.option}>
      {/* One line always: a wrapped label would make the whole switcher taller. */}
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={LABEL_MIN_FONT_SCALE}
        style={[styles.optionLabel, labelThemeStyle]}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

export function SegmentedSwitcher<T extends string | number>({
  options,
  value,
  onChange,
  style,
}: SegmentedSwitcherProps<T>) {
  const { theme } = useRecipeTheme();
  // Keyed by option index: every option reports its own frame inside the container.
  const [layouts, setLayouts] = useState<Record<number, OptionLayout>>({});

  const translateX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const indicatorHeight = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  // Index of the option the pill currently sits on; null while it is hidden.
  const placedIndexRef = useRef<number | null>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedLayout = selectedIndex >= 0 ? layouts[selectedIndex] : undefined;

  useEffect(() => {
    if (!selectedLayout) {
      // Nothing to point at: not measured yet, or `value` matches no option.
      if (placedIndexRef.current !== null) {
        placedIndexRef.current = null;
        indicatorOpacity.value = withTiming(0, { duration: INDICATOR_FADE_DURATION });
      }
      return;
    }

    const pillWidth = selectedLayout.width * INDICATOR_WIDTH_RATIO;
    const pillX = selectedLayout.x + (selectedLayout.width - pillWidth) / 2;
    const placedIndex = placedIndexRef.current;

    if (placedIndex !== null && placedIndex !== selectedIndex) {
      // Selection change: slide from the previous option to the new one.
      translateX.value = withTiming(pillX, INDICATOR_SLIDE_CONFIG);
      indicatorWidth.value = withTiming(pillWidth, INDICATOR_SLIDE_CONFIG);
      indicatorHeight.value = withTiming(selectedLayout.height, INDICATOR_SLIDE_CONFIG);
    } else {
      // First placement, or the same option reporting a new frame (the container was
      // resized): jump straight there. Sliding would start from the left edge or from
      // stale geometry and could draw the pill outside the container on the way.
      translateX.value = pillX;
      indicatorWidth.value = pillWidth;
      indicatorHeight.value = selectedLayout.height;
    }

    placedIndexRef.current = selectedIndex;
    indicatorOpacity.value = withTiming(1, { duration: INDICATOR_FADE_DURATION });
  }, [
    selectedIndex,
    selectedLayout,
    translateX,
    indicatorWidth,
    indicatorHeight,
    indicatorOpacity,
  ]);

  const indicatorMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: indicatorWidth.value,
    height: indicatorHeight.value,
    opacity: indicatorOpacity.value,
  }));
  const indicatorThemeStyle = useAnimatedThemeStyle({
    backgroundColor: withOpacity(theme.icon, 0.15),
    borderColor: withOpacity(theme.icon, 0.3),
  });
  const containerThemeStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });

  const handleOptionLayout = (index: number, event: LayoutChangeEvent) => {
    const { x, width, height } = event.nativeEvent.layout;

    setLayouts((previous) => {
      const current = previous[index];
      if (current && current.x === x && current.width === width && current.height === height) {
        return previous;
      }
      return { ...previous, [index]: { x, width, height } };
    });
  };

  return (
    <ShadowSurface style={[styles.container, style]}>
      {/* The palette-animated fill is its own layer so the shadow wrapper stays a plain View. */}
      <Animated.View pointerEvents="none" style={[styles.background, containerThemeStyle]} />
      {/* Single pill behind the labels; it slides to the selected option. */}
      <Animated.View
        testID="segmented-switcher-indicator"
        pointerEvents="none"
        style={[styles.indicator, indicatorMotionStyle, indicatorThemeStyle]}
      />

      {options.map((option, index) => (
        <SwitcherOption
          key={option.value}
          label={option.label}
          isSelected={option.value === value}
          onPress={() => {
            // Re-pressing the current option is a no-op for the parent.
            if (option.value !== value) onChange(option.value);
          }}
          onLayout={(event) => handleOptionLayout(index, event)}
        />
      ))}
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  background: {
    borderRadius: CONTAINER_RADIUS,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  container: {
    borderRadius: CONTAINER_RADIUS,
    flexDirection: 'row',
    padding: CONTAINER_PADDING,
  },
  indicator: {
    borderRadius: INDICATOR_RADIUS,
    borderWidth: 1,
    // Option frames are measured from the container's edge, so the pill starts there too.
    left: 0,
    position: 'absolute',
    top: CONTAINER_PADDING,
  },
  option: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  optionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
  },
});
