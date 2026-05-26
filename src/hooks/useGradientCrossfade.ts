import { useLayoutEffect, useRef, useState } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type GradientColors = [string, string];

export function useGradientCrossfade(colors: GradientColors) {
  const currentColorsRef = useRef<GradientColors>(colors);
  const [currentColors, setCurrentColors] = useState<GradientColors>(colors);
  const [previousColors, setPreviousColors] = useState<GradientColors>(colors);
  const progress = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  useLayoutEffect(() => {
    const current = currentColorsRef.current;
    const hasChanged = current[0] !== colors[0] || current[1] !== colors[1];

    if (!hasChanged) return;

    progress.value = 0;
    setPreviousColors(current);
    currentColorsRef.current = colors;
    setCurrentColors(colors);
    progress.value = withTiming(1, {
      duration: 450,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [colors, progress]);

  return {
    currentColors,
    previousColors,
    animatedStyle,
    AnimatedView: Animated.View,
  };
}
