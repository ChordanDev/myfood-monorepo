import { memo, useMemo } from 'react';
import { Pressable, View, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

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
      if (isSelected) {
        if (isToday) {
          return { bg: theme.primaryAccent, border: theme.colorMedium, borderWidth: 2 };
        }
        return { bg: theme.primaryAccent, border: theme.primaryAccent, borderWidth: 1 };
      }

      if (isToday) {
        return { bg: theme.icon, border: theme.colorMedium, borderWidth: 2 };
      }

      if (isPlanned) {
        return { bg: theme.icon, border: 'transparent', borderWidth: 0 };
      }

      return { bg: 'transparent', border: 'transparent', borderWidth: 0 };
    }, [isSelected, isToday, isPlanned, theme]);

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
          className="active:scale-95"
          accessibilityRole="button"
          accessibilityState={{ disabled: !isSelectable }}>
          <View
            style={{
              width: daySize,
              height: daySize,
              borderRadius: daySize / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.bg,
              borderColor: colors.border,
              borderWidth: colors.borderWidth,
            }}>
            <Text
              style={{ color: textColor, fontSize: dayFontSize }}
              className="font-inter-semibold">
              {dayDate.getDate()}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }
);
