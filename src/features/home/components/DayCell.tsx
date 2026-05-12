import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { CALENDAR_COLORS } from '../constants/calendar';

export interface DayCellProps {
  dayDate: Date;
  dateString: string;
  isSelectable: boolean;
  isSelected: boolean;
  isToday: boolean;
  isPlanned: boolean;
  daySize: number;
  dayFontSize: number;
  textColor: string;
  onSelect: (dateString: string) => void;
}

export function DayCell({
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
}: DayCellProps) {
  const textScale = useSharedValue(1);
  const circleScale = useSharedValue(1);

  const getColors = () => {
    if (isSelected) return { bg: CALENDAR_COLORS.activeBg, border: CALENDAR_COLORS.activeBorder, borderWidth: 1 };
    if (isToday) return { bg: CALENDAR_COLORS.todayBg, border: CALENDAR_COLORS.todayBorder, borderWidth: 1 };
    if (isPlanned) return { bg: CALENDAR_COLORS.inactiveBg, border: CALENDAR_COLORS.inactiveBorder, borderWidth: 1 };
    return { bg: 'transparent', border: 'transparent', borderWidth: 0 };
  };

  const colors = getColors();

  useEffect(() => {
    const duration = 100;
    const easing = Easing.out(Easing.quad);

    if (isSelected) {
      textScale.value = withSequence(
        withTiming(0.92, { duration, easing }),
        withTiming(1, { duration, easing })
      );
      circleScale.value = withSequence(
        withTiming(0.92, { duration, easing }),
        withTiming(1, { duration, easing })
      );
    } else {
      textScale.value = withTiming(1, { duration, easing });
      circleScale.value = withTiming(1, { duration, easing });
    }
  }, [isSelected, textScale, circleScale]);

  const animatedCircleStyle = useAnimatedStyle(() => {
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
        onPress={() => {
          if (!isSelected) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          onSelect(dateString);
        }}
        hitSlop={8}
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
            style={[{ color: textColor, fontSize: dayFontSize }, animatedTextStyle]}
            className="font-inter-semibold">
            {dayDate.getDate()}
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}
