import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextLayoutEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  Extrapolation,
  interpolate,
  useReducedMotion,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withOpacity } from '@/utils/colors';
import { ArrowUp, Mic, Plus } from 'lucide-react-native';
import {
  CHAT_COMPOSER_CLEARANCE,
  CHAT_COMPOSER_CONTROL_ROW_HEIGHT,
  CHAT_COMPOSER_MAX_HEIGHT,
  CHAT_COMPOSER_MIN_HEIGHT,
  CHAT_COMPOSER_TEXT_LINE_HEIGHT,
  CHAT_COMPOSER_VERTICAL_INSET,
} from '../constants';
import { resolveComposerLayout, resolveComposerMaxLines } from './composerLayout';

interface ChatComposerProps {
  value: string;
  isThinking: boolean;
  onChangeText: (value: string) => void;
  onHeightChange?: (height: number) => void;
  /**
   * How far the keyboard lifts the composer above its resting position; zero at rest. It is the
   * target of the lift, reported when the lift starts, so the owner can make room in step.
   */
  onKeyboardLiftChange?: (lift: number) => void;
  onSubmit: () => void;
  /** Hint shown while the input is empty. Defaults to a generic one. */
  placeholder?: string;
  /** Blocks typing and every control, and dims the composer. */
  disabled?: boolean;
  /**
   * Gap between the bottom safe-area inset and the composer at rest. Defaults to the composer
   * clearance alone; a route with a tab bar adds the room the tab bar takes.
   */
  restingBottomGap?: number;
  /** Prefix of every testID, so each screen can tell its composer apart. */
  testIDPrefix?: string;
}

const CHAT_COMPOSER_PLACEHOLDER = 'Decile a la IA lo que te gustaria';
const CHAT_COMPOSER_TEST_ID_PREFIX = 'chat-composer';
const CHAT_COMPOSER_DISABLED_OPACITY = 0.5;

const CHAT_COMPOSER_MIN_RADIUS = 28;
const CHAT_COMPOSER_MAX_RADIUS = 20;
const CHAT_COMPOSER_TEXT_FONT_SIZE = 17;
const CHAT_COMPOSER_LEFT_CONTROL_INSET = 56;
const CHAT_COMPOSER_INLINE_TEXT_GAP = 16;
const CHAT_COMPOSER_INLINE_LEFT_INSET =
  CHAT_COMPOSER_LEFT_CONTROL_INSET + CHAT_COMPOSER_INLINE_TEXT_GAP;
const CHAT_COMPOSER_INLINE_MAX_LINES = 2;
const CHAT_COMPOSER_STACKED_CONTENT_INSET = 16;
const CHAT_COMPOSER_STACKED_BOTTOM_INSET =
  CHAT_COMPOSER_CONTROL_ROW_HEIGHT + CHAT_COMPOSER_VERTICAL_INSET;
// Keeps the probe narrower than the inline text box, so it never flips later than the input wraps.
const CHAT_COMPOSER_PROBE_WIDTH_MARGIN = 2;
export const CHAT_COMPOSER_ICON_OPTICAL_OFFSET_Y = -3;

export function ChatComposer({
  value,
  isThinking,
  onChangeText,
  onHeightChange,
  onKeyboardLiftChange,
  onSubmit,
  placeholder = CHAT_COMPOSER_PLACEHOLDER,
  disabled = false,
  restingBottomGap = CHAT_COMPOSER_CLEARANCE,
  testIDPrefix = CHAT_COMPOSER_TEST_ID_PREFIX,
}: ChatComposerProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const { fontScale } = useWindowDimensions();
  const restingBottomOffset = insets.bottom + restingBottomGap;
  const { inputAnimatedStyle, keyboardLift } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset,
    clearance: CHAT_COMPOSER_CLEARANCE,
    bottomInset: insets.bottom,
  });
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);
  const thinkingProgress = useSharedValue(Number(isThinking));
  const composerHeight = useSharedValue(CHAT_COMPOSER_MIN_HEIGHT);
  const reportedHeight = useRef<number | null>(null);
  const [probeLines, setProbeLines] = useState(1);
  const [measuredLineHeight, setMeasuredLineHeight] = useState<number | null>(null);
  const [inputLayoutHeight, setInputLayoutHeight] = useState(0);
  // Latched per instance: an animated height that appears or disappears later is never cleaned up.
  const [animateHeight] = useState(() => Platform.OS === 'ios' && !reduceMotion);
  const hasText = value.trim().length > 0;
  const sendVisibility = useSharedValue(Number(hasText));
  const canSubmit = hasText && !isThinking && !disabled;
  // Left undefined while enabled, so the auxiliary buttons render exactly as they always did.
  const auxiliaryDisabled = disabled ? true : undefined;

  // The probe reports the native line height. Android scales it non-linearly, so the scaled
  // constant is only the fallback until the first report.
  const lineHeight = measuredLineHeight ?? CHAT_COMPOSER_TEXT_LINE_HEIGHT * fontScale;
  const layout = resolveComposerLayout(value, probeLines);
  const maxLines = resolveComposerMaxLines(lineHeight);
  const cappedHeight = maxLines * lineHeight;
  // The inline cap keeps a paste from growing the pill tall before the probe stacks it.
  const inputMaxHeight =
    (layout === 'inline' ? CHAT_COMPOSER_INLINE_MAX_LINES : maxLines) * lineHeight;
  // Half a point of slack absorbs the pixel rounding of the laid-out height.
  const isAtCap = layout === 'stacked' && inputLayoutHeight >= cappedHeight - 0.5;
  const inputRightInset = hasText ? 104 : 56;
  const inlineRightInset = inputRightInset + CHAT_COMPOSER_INLINE_TEXT_GAP;
  const inlineVerticalPadding =
    CHAT_COMPOSER_VERTICAL_INSET + Math.max(0, (CHAT_COMPOSER_CONTROL_ROW_HEIGHT - lineHeight) / 2);

  useEffect(() => {
    onKeyboardLiftChange?.(keyboardLift);
  }, [keyboardLift, onKeyboardLiftChange]);

  useEffect(() => {
    sendVisibility.value = reduceMotion
      ? Number(hasText)
      : withTiming(Number(hasText), { duration: 180 });
  }, [hasText, reduceMotion, sendVisibility]);

  useEffect(() => {
    const nextProgress = Number(isThinking);

    thinkingProgress.value = reduceMotion
      ? nextProgress
      : withTiming(
          nextProgress,
          { duration: 180, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished && nextProgress === 0) rotation.value = 0;
          }
        );
  }, [isThinking, reduceMotion, rotation, thinkingProgress]);

  useEffect(() => {
    cancelAnimation(rotation);

    if (isThinking && !reduceMotion) {
      // eslint-disable-next-line react-hooks/immutability -- Starts the Reanimated thinking indicator outside render.
      rotation.value = withRepeat(
        withTiming(360, { duration: 2600, easing: Easing.linear }),
        0,
        false
      );
    }

    return () => cancelAnimation(rotation);
  }, [isThinking, reduceMotion, rotation]);

  const handleProbeTextLayout = useCallback(({ nativeEvent }: TextLayoutEvent) => {
    const firstLineHeight = nativeEvent.lines[0]?.height;

    setProbeLines(Math.max(1, nativeEvent.lines.length));
    if (Number.isFinite(firstLineHeight) && firstLineHeight > 0) {
      setMeasuredLineHeight(firstLineHeight);
    }
  }, []);

  const handleInputLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    setInputLayoutHeight(nativeEvent.layout.height);
  }, []);

  const handleContentLayout = useCallback(
    ({ nativeEvent }: LayoutChangeEvent) => {
      const nextHeight = nativeEvent.layout.height;
      const previousHeight = reportedHeight.current;

      // During the iOS tween the content height flips by a device pixel; a real change is a line.
      if (previousHeight !== null && Math.abs(nextHeight - previousHeight) < 1) return;

      reportedHeight.current = nextHeight;
      // The first measurement is assigned directly so a taller pill never mounts clipped.
      composerHeight.set(
        previousHeight === null || !animateHeight
          ? nextHeight
          : withTiming(nextHeight, { duration: 180, easing: Easing.out(Easing.cubic) })
      );
      onHeightChange?.(nextHeight);
    },
    [animateHeight, composerHeight, onHeightChange]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${rotation.value}deg` }],
  }));

  const sendContainerStyle = useAnimatedStyle(() => ({
    width: 48 * sendVisibility.value,
    opacity: sendVisibility.value,
    transform: [
      { translateX: 6 * (1 - sendVisibility.value) },
      { scale: 0.92 + 0.08 * sendVisibility.value },
    ],
  }));

  const frameStyle = useAnimatedStyle(() => {
    const height = composerHeight.get();
    const borderRadius = interpolate(
      height,
      [CHAT_COMPOSER_MIN_HEIGHT, CHAT_COMPOSER_MAX_HEIGHT],
      [CHAT_COMPOSER_MIN_RADIUS, CHAT_COMPOSER_MAX_RADIUS],
      Extrapolation.CLAMP
    );

    // Without the tween there is no height key at all: the frame is sized by its in-flow content
    // in the same native layout pass as the input.
    return animateHeight ? { height, borderRadius } : { borderRadius };
  });

  const innerSurfaceStyle = useAnimatedStyle(() => {
    const thinkingInset = 2 * thinkingProgress.value;

    return {
      top: thinkingInset,
      right: thinkingInset,
      bottom: thinkingInset,
      left: thinkingInset,
      borderRadius:
        interpolate(
          composerHeight.get(),
          [CHAT_COMPOSER_MIN_HEIGHT, CHAT_COMPOSER_MAX_HEIGHT],
          [CHAT_COMPOSER_MIN_RADIUS, CHAT_COMPOSER_MAX_RADIUS],
          Extrapolation.CLAMP
        ) - thinkingInset,
    };
  });

  const surfaceTintStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.4 * thinkingProgress.value,
  }));

  const gradientStyle = useAnimatedStyle(() => ({
    opacity: thinkingProgress.value,
  }));

  return (
    <Animated.View
      testID={`${testIDPrefix}-wrapper`}
      style={[styles.wrapper, { paddingBottom: restingBottomOffset }, inputAnimatedStyle]}>
      <Animated.View
        testID={`${testIDPrefix}-frame`}
        style={[
          styles.frame,
          {
            borderCurve: 'continuous',
          },
          disabled ? styles.frameDisabled : undefined,
          frameStyle,
        ]}>
        <Animated.View
          testID={`${testIDPrefix}-thinking-gradient`}
          pointerEvents="none"
          style={[
            styles.thinkingGradient,
            reduceMotion ? undefined : animatedStyle,
            gradientStyle,
          ]}>
          <LinearGradient
            colors={['#EF7C60', '#F0C85C', '#77B79D', '#6286C5', '#B572A8', '#EF7C60']}
            locations={[0, 0.2, 0.4, 0.6, 0.8, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1 }}
          />
        </Animated.View>

        <Animated.View
          testID={`${testIDPrefix}-inner-surface`}
          pointerEvents="none"
          style={[
            styles.innerSurface,
            {
              borderCurve: 'continuous',
            },
            innerSurfaceStyle,
          ]}>
          <Animated.View
            testID={`${testIDPrefix}-surface`}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: theme.colorDark },
              surfaceTintStyle,
            ]}
          />
        </Animated.View>

        {/* Measures the value at the inline width. Its geometry cannot depend on the layout mode or
            the line height, and a height, flex or display constraint would truncate or skip the
            native line measurement. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: 0,
            left: CHAT_COMPOSER_INLINE_LEFT_INSET,
            right: inlineRightInset + CHAT_COMPOSER_PROBE_WIDTH_MARGIN,
            opacity: 0,
          }}>
          <Text
            testID={`${testIDPrefix}-layout-probe`}
            onTextLayout={handleProbeTextLayout}
            textBreakStrategy="simple"
            android_hyphenationFrequency="none"
            style={styles.probeText}>
            {value || ' '}
          </Text>
        </View>

        <View
          testID={`${testIDPrefix}-content`}
          onLayout={handleContentLayout}
          style={[
            animateHeight ? styles.contentPinned : styles.contentInFlow,
            layout === 'stacked'
              ? styles.contentStacked
              : {
                  paddingLeft: CHAT_COMPOSER_INLINE_LEFT_INSET,
                  paddingRight: inlineRightInset,
                  paddingVertical: inlineVerticalPadding,
                },
          ]}>
          <View>
            {!value ? (
              <View
                testID={`${testIDPrefix}-placeholder`}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.placeholder, { height: lineHeight }]}>
                <Text
                  style={{
                    color: withOpacity(theme.textLight, 0.6),
                    fontSize: 15,
                    lineHeight: 20,
                  }}>
                  {placeholder}
                </Text>
              </View>
            ) : null}
            {/* The native input owns its height. The blank placeholder makes it measure exactly one
                native line while empty; the visible placeholder is the overlay above. */}
            <TextInput
              testID={`${testIDPrefix}-input`}
              value={value}
              onChangeText={onChangeText}
              onLayout={handleInputLayout}
              editable={!disabled}
              // The visible placeholder is hidden from assistive tech, so a disabled input has to
              // carry the reason itself.
              accessibilityLabel={disabled ? placeholder : undefined}
              accessibilityState={disabled ? { disabled: true } : undefined}
              multiline
              placeholder=" "
              scrollEnabled={isAtCap}
              submitBehavior="newline"
              textAlignVertical="top"
              textBreakStrategy="simple"
              style={{
                color: theme.appBg,
                fontSize: CHAT_COMPOSER_TEXT_FONT_SIZE,
                lineHeight: CHAT_COMPOSER_TEXT_LINE_HEIGHT,
                minHeight: lineHeight,
                // iOS measures the commit that clears the value with the text the native input
                // still holds, and nothing measures it again until the next edit. An empty input
                // is therefore exactly one line.
                maxHeight: value === '' ? lineHeight : inputMaxHeight,
                padding: 0,
              }}
            />
          </View>
        </View>

        <View style={[styles.leftControl, { bottom: CHAT_COMPOSER_VERTICAL_INSET, left: 8 }]}>
          <Pressable
            accessibilityLabel="Add meal detail"
            accessibilityRole="button"
            disabled={auxiliaryDisabled}
            style={styles.controlButton}
            hitSlop={8}>
            <View style={{ transform: [{ translateY: CHAT_COMPOSER_ICON_OPTICAL_OFFSET_Y }] }}>
              <Plus size={24} color={theme.appBg} strokeWidth={2.5} />
            </View>
          </Pressable>
        </View>

        <View
          testID={`${testIDPrefix}-controls`}
          style={[styles.controls, { right: 8, bottom: CHAT_COMPOSER_VERTICAL_INSET }]}>
          <Pressable
            accessibilityLabel="Voice input"
            accessibilityRole="button"
            disabled={auxiliaryDisabled}
            style={styles.controlButton}
            hitSlop={8}>
            <View style={{ transform: [{ translateY: CHAT_COMPOSER_ICON_OPTICAL_OFFSET_Y }] }}>
              <Mic size={22} color={theme.appBg} strokeWidth={2} />
            </View>
          </Pressable>

          <Animated.View
            pointerEvents={hasText ? 'auto' : 'none'}
            style={[styles.sendContainer, sendContainerStyle]}>
            <Pressable
              testID={`${testIDPrefix}-submit`}
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={onSubmit}
              hitSlop={8}
              style={[styles.controlButton, { opacity: canSubmit ? 1 : 0.45 }]}>
              <View style={{ transform: [{ translateY: CHAT_COMPOSER_ICON_OPTICAL_OFFSET_Y }] }}>
                <ArrowUp size={24} color={theme.appBg} strokeWidth={2.5} />
              </View>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The frame centres its children, so the in-flow content has to stretch to span its width.
  contentInFlow: {
    alignSelf: 'stretch',
  },
  contentPinned: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  contentStacked: {
    paddingBottom: CHAT_COMPOSER_STACKED_BOTTOM_INSET,
    paddingHorizontal: CHAT_COMPOSER_STACKED_CONTENT_INSET,
    paddingTop: CHAT_COMPOSER_VERTICAL_INSET,
  },
  controlButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    position: 'absolute',
  },
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  frameDisabled: {
    opacity: CHAT_COMPOSER_DISABLED_OPACITY,
  },
  innerSurface: {
    overflow: 'hidden',
    position: 'absolute',
  },
  leftControl: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  placeholder: {
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  probeText: {
    fontSize: CHAT_COMPOSER_TEXT_FONT_SIZE,
    lineHeight: CHAT_COMPOSER_TEXT_LINE_HEIGHT,
  },
  sendContainer: {
    height: 42,
    overflow: 'hidden',
  },
  thinkingGradient: {
    aspectRatio: 1,
    position: 'absolute',
    width: '160%',
  },
  wrapper: {
    bottom: 0,
    paddingHorizontal: 14,
    position: 'absolute',
    width: '100%',
  },
});
