import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { NoisyBackground } from '@/components/NoisyBackground';

const GRADIENT_START = { x: 0, y: 0 };
const GRADIENT_END = { x: 0, y: 1 };
// The dark surface only tints the top tenth of the screen; the rest is the plain ground.
const GRADIENT_LOCATIONS = [0, 0.1] as const;
const NOISE_OPACITY = 0.3;

/**
 * Screen ground of the recipe screens, which open with the dark top fade: the dark surface melting
 * into the ground, under a noise texture. A palette change crossfades the two gradients.
 */
export function RecipeTopGradient() {
  const { theme } = useRecipeTheme();
  const { currentColors, previousColors, animatedStyle, AnimatedView } = useGradientCrossfade([
    theme.colorDark,
    theme.appBg,
  ]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={previousColors}
        start={GRADIENT_START}
        end={GRADIENT_END}
        locations={GRADIENT_LOCATIONS}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedView style={[StyleSheet.absoluteFill, animatedStyle]}>
        <LinearGradient
          colors={currentColors}
          start={GRADIENT_START}
          end={GRADIENT_END}
          locations={GRADIENT_LOCATIONS}
          style={styles.gradient}
        />
      </AnimatedView>
      <NoisyBackground opacity={NOISE_OPACITY} />
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
});
