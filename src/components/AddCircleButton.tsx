import { useEffect } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { PLUS_SVG } from '@/constants/svgIcons';
import { ShadowSurface } from './ShadowSurface';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

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

  const transition = useSharedValue(0);

  useEffect(() => {
    transition.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3000, easing: Easing.linear }),
        withTiming(0, { duration: 0 })
      ),
      -1
    );

    return () => {
      cancelAnimation(transition);
    };
  }, [transition]);

  const translateX = useDerivedValue(() =>
    interpolate(transition.value, [0, 1], [-2 * buttonSize, 0])
  );

  const animatedGradientStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: translateX.value,
      },
    ],
    width: buttonSize * 3,
    height: buttonSize,
    position: 'absolute',
    left: 0,
    top: 0,
  }));

  return (
    <ShadowSurface style={{ borderRadius: radius }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Agregar"
        className="items-center justify-center active:scale-95"
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: 'transparent',
        }}>
        <Animated.View style={animatedGradientStyle}>
          <LinearGradient
            colors={[
              theme.primaryAccentIntense,
              theme.lightColor,
              theme.primaryAccent,
              theme.primaryAccentIntense,
              theme.lightColor,
              theme.primaryAccent,
              theme.primaryAccentIntense,
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerRadius,
            backgroundColor: theme.darkColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <SvgXml xml={PLUS_SVG} width={plusSize} height={plusSize} color={theme.primaryAccent} />
        </View>
      </Pressable>
    </ShadowSurface>
  );
}
