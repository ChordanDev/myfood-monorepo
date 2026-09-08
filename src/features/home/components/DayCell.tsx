import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';

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

export const DayCell = memo(
  ({
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
  }: DayCellProps) => {
    const { theme } = useRecipeTheme();

    const colors = useMemo(() => {
      const targetOpacity = 0.7;
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
    }, [isSelected, isToday, isPlanned, theme]);
    const selectionStateKey = `${isSelected}-${isToday}-${isPlanned}-${isSelectable}`;
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
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
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
                borderWidth: colors.borderWidth,
              },
              circleStyle,
            ]}>
            <Animated.Text style={[styles.dayText, { fontSize: dayFontSize }, textStyle]}>
              {dayDate.getDate()}
            </Animated.Text>
          </Animated.View>
        </Pressable>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  dayText: {
    fontFamily: 'Inter_600SemiBold',
  },
});
