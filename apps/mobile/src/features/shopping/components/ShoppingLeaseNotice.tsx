import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

// Shown while renewals of the Cart keep failing to reach the server. Nothing to press: the
// renewals go on by themselves, and the first one that succeeds hides it.
export function ShoppingLeaseNotice() {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const messageStyle = useAnimatedThemeStyle({ color: theme.textDark });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <Animated.Text accessibilityRole="alert" style={[styles.message, messageStyle]}>
          Perdimos la conexión y no pudimos renovar tu carrito. Puede que haya vencido.
        </Animated.Text>
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  shadowSurface: {
    borderRadius: 24,
  },
  surface: {
    borderRadius: 21,
    padding: 16,
  },
});
