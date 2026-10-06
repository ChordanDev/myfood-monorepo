import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';

interface RecipeBottomFadeProps {
  /** Measured from the bottom edge of the screen. */
  height: number;
}

const GRADIENT_START = { x: 0, y: 0 };
const GRADIENT_END = { x: 0, y: 1 };
// Clear at the top, solid ground from 45% down: the bottom 55% hides what scrolls behind the
// composer.
const GRADIENT_LOCATIONS = [0, 0.45] as const;

/** Melts the scrolling content into the ground before it reaches the composer. */
export function RecipeBottomFade({ height }: RecipeBottomFadeProps) {
  const { theme } = useRecipeTheme();

  return (
    <View testID="recipe-bottom-fade" pointerEvents="none" style={[styles.fade, { height }]}>
      <LinearGradient
        colors={[withOpacity(theme.appBg, 0), theme.appBg]}
        start={GRADIENT_START}
        end={GRADIENT_END}
        locations={GRADIENT_LOCATIONS}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
