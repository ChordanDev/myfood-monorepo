import { Pressable, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import type { HomeMealType } from '../domain/localMealPlan';

export type EatTodayDestinationType = Extract<HomeMealType, 'almuerzo' | 'cena'>;

export const EAT_TODAY_DESTINATION_TYPES: EatTodayDestinationType[] = ['almuerzo', 'cena'];

export const EAT_TODAY_CUTOFF_MINUTES: Record<EatTodayDestinationType, number> = {
  almuerzo: 15 * 60,
  cena: 22 * 60,
};

export const EAT_TODAY_LABEL: Record<EatTodayDestinationType, string> = {
  almuerzo: 'Mediodía',
  cena: 'Cena',
};

interface EatTodayButtonProps {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  sizeScale: number;
  backgroundColor: string;
  textColor: string;
  borderColor?: string;
  onPress: () => void;
}

export function EatTodayButton({
  leftPercent,
  topPercent,
  widthPercent,
  sizeScale,
  backgroundColor,
  textColor,
  borderColor,
  onPress,
}: EatTodayButtonProps) {
  const { width: screenWidth } = useWindowDimensions();
  const imageWidth = Math.round((screenWidth * widthPercent * sizeScale) / 100);
  const buttonSize = Math.max(96, Math.round(imageWidth * 0.5));
  const buttonThemeStyle = useAnimatedThemeStyle({
    backgroundColor,
    ...(borderColor ? { borderColor } : {}),
  });
  const textThemeStyle = useAnimatedThemeStyle({ color: textColor });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Comer hoy"
      className="absolute items-center justify-center shadow-md active:scale-95"
      style={{
        left: `${leftPercent}%`,
        top: `${topPercent}%`,
        transform: [{ translateX: -buttonSize / 2 }, { translateY: -buttonSize / 2 }],
        width: buttonSize,
        height: buttonSize,
        borderRadius: buttonSize / 2,
        zIndex: 10,
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderRadius: buttonSize / 2,
            ...(borderColor ? { borderWidth: 2 } : {}),
          },
          buttonThemeStyle,
        ]}
      />
      <Animated.Text
        className="text-center font-inter-bold leading-tight"
        style={[{ fontSize: Math.round(buttonSize * 0.16) }, textThemeStyle]}>
        COMER{'\n'}HOY
      </Animated.Text>
    </Pressable>
  );
}
