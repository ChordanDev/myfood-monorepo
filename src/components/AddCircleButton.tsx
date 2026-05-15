import { useEffect } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { PLUS_SVG } from '@/constants/svgIcons';
import { ShadowSurface } from './ShadowSurface';
import { COLORS } from '@/constants/theme';

interface AddCircleButtonProps {
  size?: number;
  onPress?: () => void;
}

const DEFAULT_BUTTON_SIZE = 56;

export function AddCircleButton({ size = DEFAULT_BUTTON_SIZE, onPress }: AddCircleButtonProps) {
  const buttonSize = Math.round(size);
  const radius = Math.round(buttonSize / 2);
  const plusSize = Math.round(buttonSize * 0.55);

  const BORDER_WIDTH = 3;
  const innerSize = buttonSize - BORDER_WIDTH * 2;
  const innerRadius = Math.round(innerSize / 2);

  const transition = useSharedValue(0);

  useEffect(() => {
    transition.value = withRepeat(
      withTiming(1, { duration: 2500, easing: Easing.linear }),
      -1,
      false // false significa que no revierte (hace un bucle continuo 0 -> 1 -> 0 -> 1)
    );

    return () => {
      cancelAnimation(transition);
    };
  }, [transition]);

  const animatedGradientStyle = useAnimatedStyle(() => ({
    transform: [
      {
        // Trasladamos exactamente el ancho de un botón hacia la izquierda
        translateX: interpolate(transition.value, [0, 1], [0, -buttonSize]),
      },
    ],
    // El ancho del gradiente es exactamente el doble para que las dos mitades coincidan a la perfección
    width: buttonSize * 2,
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
              COLORS.bgGreen,
              COLORS.accentOrange,
              COLORS.accentYellow,
              COLORS.bgGreen,
              COLORS.accentOrange,
              COLORS.accentYellow,
              COLORS.bgGreen,
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
            backgroundColor: COLORS.bgCard,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <SvgXml xml={PLUS_SVG} width={plusSize} height={plusSize} />
        </View>
      </Pressable>
    </ShadowSurface>
  );
}
