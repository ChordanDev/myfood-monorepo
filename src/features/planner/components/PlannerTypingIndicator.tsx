import { useEffect } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

const DOT_COUNT = 3;
const DOT_BOUNCE_HEIGHT = 4;
const DOT_ANIMATION_DURATION_MS = 360;
const DOT_STAGGER_MS = 140;

interface PlannerTypingIndicatorProps {
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function PlannerTypingIndicator({ onLayout }: PlannerTypingIndicatorProps) {
  const { theme } = useRecipeTheme();

  return (
    <View
      testID="planner-typing-indicator"
      accessibilityLabel="Assistant is typing"
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      onLayout={onLayout}
      className="max-w-[94%] flex-row items-center gap-1 px-1">
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <PlannerTypingDot key={index} index={index} color={theme.textBlack} />
      ))}
    </View>
  );
}

function PlannerTypingDot({ index, color }: { index: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);

    if (!reduceMotion) {
      progress.value = withDelay(
        index * DOT_STAGGER_MS,
        withRepeat(
          withSequence(
            withTiming(1, {
              duration: DOT_ANIMATION_DURATION_MS,
              easing: Easing.out(Easing.cubic),
            }),
            withTiming(0, {
              duration: DOT_ANIMATION_DURATION_MS,
              easing: Easing.in(Easing.cubic),
            })
          ),
          0,
          false
        )
      );
    } else {
      progress.value = 0;
    }

    return () => cancelAnimation(progress);
  }, [index, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -DOT_BOUNCE_HEIGHT * progress.value }],
  }));

  return (
    <Animated.View
      style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }, style]}
    />
  );
}
