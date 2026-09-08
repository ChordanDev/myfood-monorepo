import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { PLUS_SVG } from '@/constants/svgIcons';
import { ShadowSurface } from './ShadowSurface';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

interface AddCircleButtonProps {
  size?: number;
  onPress?: () => void;
}

const DEFAULT_BUTTON_SIZE = 56;

export function AddCircleButton({ size = DEFAULT_BUTTON_SIZE, onPress }: AddCircleButtonProps) {
  const { theme } = useRecipeTheme();
  const buttonSize = Math.round(size);
  const radius = Math.round(buttonSize / 2);
  const plusSize = Math.round(buttonSize * 0.55);

  const BORDER_WIDTH = 3;
  const innerSize = buttonSize - BORDER_WIDTH * 2;
  const innerRadius = Math.round(innerSize / 2);

  const rotation = useSharedValue(0);
  const gradientSize = buttonSize * 2.6;
  const innerThemeStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 3600, easing: Easing.linear }),
      -1,
      false
    );

    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const animatedGradientStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${rotation.value}deg` }],
    width: gradientSize,
    height: gradientSize,
    position: 'absolute',
    left: -(gradientSize - buttonSize) / 2,
    top: -(gradientSize - buttonSize) / 2,
  }));

  return (
    <ShadowSurface style={{ borderRadius: radius }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Agregar"
        testID="home-open-planner"
        style={({ pressed }) => ({
          alignItems: 'center',
          backgroundColor: 'transparent',
          borderRadius: radius,
          height: buttonSize,
          justifyContent: 'center',
          overflow: 'hidden',
          transform: [{ scale: pressed ? 0.95 : 1 }],
          width: buttonSize,
        })}>
        <Animated.View style={animatedGradientStyle}>
          <LinearGradient
            colors={[
              theme.primaryAccentIntense,
              theme.icon,
              theme.primaryAccent,
              theme.primaryAccentIntense,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        <Animated.View
          style={[
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerRadius,
              alignItems: 'center',
              justifyContent: 'center',
            },
            innerThemeStyle,
          ]}>
          <SvgXml xml={PLUS_SVG} width={plusSize} height={plusSize} color={theme.primaryAccent} />
        </Animated.View>
      </Pressable>
    </ShadowSurface>
  );
}
