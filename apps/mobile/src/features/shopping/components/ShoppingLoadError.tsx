import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

export interface ShoppingLoadErrorProps {
  // Why the list could not be read, already in the words the user reads.
  message: string;
  onRetry: () => void;
  // What the button says. It retries a read, unless the caller gives it another job.
  actionLabel?: string;
}

// Shown when a read of the list fails. Retrying is explicit: until then the screen keeps
// whatever list it had.
export function ShoppingLoadError({
  message,
  onRetry,
  actionLabel = 'Reintentar',
}: ShoppingLoadErrorProps) {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const messageStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const buttonStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });
  const buttonLabelStyle = useAnimatedThemeStyle({ color: theme.textLight });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <Animated.Text accessibilityRole="alert" style={[styles.message, messageStyle]}>
          {message}
        </Animated.Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => pressed && styles.pressed}>
          <Animated.View style={[styles.button, buttonStyle]}>
            <Animated.Text style={[styles.buttonLabel, buttonLabelStyle]}>
              {actionLabel}
            </Animated.Text>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  buttonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.8,
  },
  shadowSurface: {
    borderRadius: 24,
  },
  surface: {
    borderRadius: 21,
    gap: 12,
    padding: 16,
  },
});
