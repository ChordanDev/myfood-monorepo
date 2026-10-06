import { useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
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
  const outlineThemeStyle = useAnimatedThemeStyle({ borderColor: textColor });

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, {
        duration: 1400,
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
      style={({ pressed }) => ({
        alignItems: 'center',
        borderRadius,
        height: buttonHeight,
        justifyContent: 'center',
        left: `${leftPercent}%`,
        overflow: 'visible',
        position: 'absolute',
        top: `${topPercent}%`,
        transform: [
          { translateX: -buttonWidth / 2 },
          { translateY: -buttonHeight / 2 },
          { scale: pressed ? 0.95 : 1 },
        ],
        width: buttonWidth,
        zIndex: 10,
      })}>
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
        style={[
          {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderRadius,
            borderWidth: 2,
            backgroundColor: 'transparent',
          },
          outlineThemeStyle,
        ]}
      />
      <Animated.Text style={[styles.label, { fontSize: 13, letterSpacing: 0.8 }, textThemeStyle]}>
        COMERLO HOY
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Montserrat_600SemiBold',
    lineHeight: 16.25,
    textAlign: 'center',
  },
});
