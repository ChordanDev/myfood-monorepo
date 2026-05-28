import { useEffect } from 'react';
import { Pressable, useWindowDimensions } from 'react-native';
import { BlurMask, Canvas, RoundedRect } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
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

  // PROTOTYPE: static transparent pill; Skia draws a soft outer-only breathing light.
  const buttonWidth = Math.max(108, Math.round(imageWidth * 0.52));
  const buttonHeight = Math.max(35, Math.round(buttonWidth * 0.32));
  const borderRadius = buttonHeight / 2;
  const glowPadding = 22;
  const glowColor = borderColor ?? backgroundColor;
  const breath = useSharedValue(0);
  const textThemeStyle = useAnimatedThemeStyle({ color: textColor });

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, {
        duration: 1800,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
  }, [breath]);

  const breathingLightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breath.value, [0, 1], [0.28, 0.74]),
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Comer hoy"
      className="absolute items-center justify-center active:scale-95"
      style={{
        left: `${leftPercent}%`,
        top: `${topPercent}%`,
        transform: [{ translateX: -buttonWidth / 2 }, { translateY: -buttonHeight / 2 }],
        width: buttonWidth,
        height: buttonHeight,
        borderRadius,
        zIndex: 10,
        overflow: 'visible',
      }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: -glowPadding,
            top: -glowPadding,
            width: buttonWidth + glowPadding * 2,
            height: buttonHeight + glowPadding * 2,
          },
          breathingLightStyle,
        ]}>
        <Canvas
          style={{ width: buttonWidth + glowPadding * 2, height: buttonHeight + glowPadding * 2 }}>
          <RoundedRect
            x={glowPadding}
            y={glowPadding}
            width={buttonWidth}
            height={buttonHeight}
            r={borderRadius}
            color={glowColor}>
            <BlurMask blur={14} style="outer" />
          </RoundedRect>
        </Canvas>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius,
          borderWidth: 2,
          borderColor: '#000000',
          backgroundColor: 'transparent',
        }}
      />
      <Animated.Text
        className="text-center font-montserrat-semibold leading-tight"
        style={[{ fontSize: 13, letterSpacing: 0.8 }, textThemeStyle]}>
        Comerlo Hoy
      </Animated.Text>
    </Pressable>
  );
}
