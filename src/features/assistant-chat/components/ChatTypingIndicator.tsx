import { useEffect } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

const BREATH_HALF_DURATION_MS = 900;
const BREATH_SCALE = 1.06;
const RESTING_OPACITY = 0.82;

interface ChatTypingIndicatorProps {
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function ChatTypingIndicator({ onLayout }: ChatTypingIndicatorProps) {
  const { theme } = useRecipeTheme();
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(breath);
    breath.set(0);

    if (!reduceMotion) {
      breath.set(
        withRepeat(
          withSequence(
            withTiming(1, {
              duration: BREATH_HALF_DURATION_MS,
              easing: Easing.inOut(Easing.cubic),
            }),
            withTiming(0, {
              duration: BREATH_HALF_DURATION_MS,
              easing: Easing.inOut(Easing.cubic),
            })
          ),
          -1,
          false
        )
      );
    }

    return () => {
      cancelAnimation(breath);
      breath.set(0);
    };
  }, [breath, reduceMotion]);

  const breathingStyle = useAnimatedStyle(() => {
    const progress = breath.get();

    return {
      opacity: RESTING_OPACITY + (1 - RESTING_OPACITY) * progress,
      transform: [{ scale: 1 + (BREATH_SCALE - 1) * progress }],
    };
  });

  return (
    <View
      testID="planner-typing-indicator"
      accessible
      accessibilityLabel="Preparando respuesta"
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      role="status"
      pointerEvents="none"
      onLayout={onLayout}
      style={styles.container}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.seedFootprint}>
        <Animated.View
          testID="planner-thinking-seed-body"
          style={[styles.seedBody, breathingStyle]}>
          <View
            testID="planner-thinking-seed-shape"
            style={[styles.seedShape, { backgroundColor: theme.textBlack }]}>
            <View
              testID="planner-thinking-seed-vein"
              style={[styles.seedVein, { backgroundColor: theme.appBg }]}
            />
          </View>
        </Animated.View>
      </View>
      <Text accessible={false} style={[styles.statusLabel, { color: theme.textBlack }]}>
        Preparando respuesta…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    height: 28,
    paddingHorizontal: 3.5,
    width: 190,
  },
  seedBody: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  seedFootprint: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  seedShape: {
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    height: 19,
    transform: [{ rotate: '-32deg' }],
    width: 13,
  },
  seedVein: {
    borderRadius: 1,
    height: 9,
    left: 5.75,
    position: 'absolute',
    top: 4,
    transform: [{ rotate: '-8deg' }],
    width: 1.5,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
    lineHeight: 18,
  },
});
