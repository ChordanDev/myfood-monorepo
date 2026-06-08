import { useLayoutEffect, useRef, useState } from 'react';
import {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type AnimatedColorProperty = 'backgroundColor' | 'borderColor' | 'color';
type AnimatedColorStyle = Partial<Record<AnimatedColorProperty, string>>;

function colorsAreEqual(a: AnimatedColorStyle, b: AnimatedColorStyle) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const colorKey = key as AnimatedColorProperty;
    if (a[colorKey] !== b[colorKey]) return false;
  }
  return true;
}

export function useAnimatedThemeStyle(
  colors: AnimatedColorStyle,
  options: { immediateKey?: string | number | boolean | null } = {}
) {
  const currentColorsRef = useRef(colors);
  const immediateKeyRef = useRef(options.immediateKey);
  const [fromColors, setFromColors] = useState(colors);
  const [toColors, setToColors] = useState(colors);
  const progress = useSharedValue(1);

  useLayoutEffect(() => {
    const currentColors = currentColorsRef.current;
    if (colorsAreEqual(currentColors, colors)) return;

    const shouldApplyImmediately = immediateKeyRef.current !== options.immediateKey;

    if (shouldApplyImmediately) {
      immediateKeyRef.current = options.immediateKey;
      progress.value = 1;
      currentColorsRef.current = colors;
      setFromColors(colors);
      setToColors(colors);
      return;
    }

    progress.value = 0;
    setFromColors(currentColors);
    currentColorsRef.current = colors;
    setToColors(colors);
    progress.value = withTiming(1, {
      duration: 450,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [colors, options.immediateKey, progress]);

  return useAnimatedStyle(() => {
    const style: Record<string, string> = {};

    for (const key of Object.keys(toColors) as AnimatedColorProperty[]) {
      const fromColor = fromColors[key] ?? toColors[key];
      const toColor = toColors[key];

      if (!fromColor || !toColor) continue;

      style[key] = interpolateColor(progress.value, [0, 1], [fromColor, toColor]);
    }

    return style;
  }, [fromColors, toColors]);
}
