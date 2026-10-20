import { Pressable, StyleSheet, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

interface LoadErrorNoticeProps {
  /** What failed to load and what retrying brings back. */
  message: string;
  onRetry: () => void;
  testID: string;
}

// Shown when data on the screen could not be loaded. Retrying is explicit:
// the screen never reloads on its own after a failure.
export function LoadErrorNotice({ message, onRetry, testID }: LoadErrorNoticeProps) {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <Text style={[styles.message, { color: theme.textDark }]}>{message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          testID={testID}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.colorDark, opacity: pressed ? 0.8 : 1 },
          ]}>
          <Text style={[styles.buttonLabel, { color: theme.textLight }]}>Reintentar</Text>
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
  shadowSurface: {
    borderRadius: 21,
  },
  surface: {
    borderRadius: 21,
    gap: 12,
    padding: 16,
  },
});
