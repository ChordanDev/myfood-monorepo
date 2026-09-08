import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputContentSizeChangeEventData,
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
  CUSTOM_TAB_BAR_CONTENT_HEIGHT,
  PLANNER_CHAT_INPUT_CLEARANCE,
  PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT,
  PLANNER_CHAT_INPUT_MAX_HEIGHT,
  PLANNER_CHAT_INPUT_MAX_LINES,
  PLANNER_CHAT_INPUT_MIN_HEIGHT,
  PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
  PLANNER_CHAT_INPUT_VERTICAL_INSET,
} from '../constants';

interface PlannerChatInputProps {
  value: string;
  isThinking: boolean;
  onChangeText: (value: string) => void;
  onHeightChange?: (height: number) => void;
  onRenderedHeightChange?: (height: number) => void;
  onSubmit: () => void;
}

const PLANNER_CHAT_INPUT_MIN_RADIUS = 28;
const PLANNER_CHAT_INPUT_MAX_RADIUS = 20;
const PLANNER_CHAT_INPUT_ONE_LINE_LEFT_INSET = 56;
const PLANNER_CHAT_INPUT_MULTILINE_CONTENT_INSET = 16;
export const PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y = -3;
const PLANNER_CHAT_INPUT_CONTROL_TOP_OFFSET =
  PLANNER_CHAT_INPUT_VERTICAL_INSET +
  (PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT - PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT) / 2;
const PLANNER_CHAT_INPUT_MULTILINE_TEXT_BOTTOM_OFFSET =
  PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT + PLANNER_CHAT_INPUT_VERTICAL_INSET;

export function PlannerChatInput({
  value,
  isThinking,
  onChangeText,
  onHeightChange,
  onRenderedHeightChange,
  onSubmit,
}: PlannerChatInputProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const { inputAnimatedStyle } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset:
      insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT + PLANNER_CHAT_INPUT_CLEARANCE,
    clearance: PLANNER_CHAT_INPUT_CLEARANCE,
  });
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);
  const thinkingProgress = useSharedValue(Number(isThinking));
  const composerHeight = useSharedValue(PLANNER_CHAT_INPUT_MIN_HEIGHT);
  const reportedHeight = useRef(PLANNER_CHAT_INPUT_MIN_HEIGHT);
  const controlSafeOneLineContentHeight = useRef(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
  const multilineMeasurementOneLineContentHeight = useRef(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
  const hasCalibratedControlSafeOneLineContentHeight = useRef(false);
  const hasCalibratedMultilineMeasurementOneLineContentHeight = useRef(false);
  const isMultilineRef = useRef(false);
  const multilineMeasurementLines = useRef(1);
  const [inputHeight, setInputHeight] = useState(PLANNER_CHAT_INPUT_MIN_HEIGHT);
  const [isMultiline, setIsMultiline] = useState(false);
  const hasText = value.trim().length > 0;
  const sendVisibility = useSharedValue(Number(hasText));
  const canSubmit = hasText && !isThinking;

  const updateHeight = useCallback(
    (nextHeight: number) => {
      if (nextHeight === reportedHeight.current) return;

      reportedHeight.current = nextHeight;
      setInputHeight(nextHeight);
      onHeightChange?.(nextHeight);
    },
    [onHeightChange]
  );

  const updateMultilineMode = useCallback(
    (nextIsMultiline: boolean, nextHeight: number) => {
      if (nextIsMultiline !== isMultilineRef.current) {
        isMultilineRef.current = nextIsMultiline;
        setIsMultiline(nextIsMultiline);
      }

      updateHeight(nextHeight);
    },
    [updateHeight]
  );

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
      rotation.value = withRepeat(
        withTiming(360, { duration: 2600, easing: Easing.linear }),
        0,
        false
      );
    }

    return () => cancelAnimation(rotation);
  }, [isThinking, reduceMotion, rotation]);

  useEffect(() => {
    composerHeight.value =
      Platform.OS === 'android' || reduceMotion
        ? inputHeight
        : withTiming(inputHeight, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [composerHeight, inputHeight, reduceMotion]);

  useEffect(() => {
    if (!value) {
      multilineMeasurementLines.current = 1;
      updateMultilineMode(false, PLANNER_CHAT_INPUT_MIN_HEIGHT);
    }
  }, [updateMultilineMode, value]);

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

  const composerStyle = useAnimatedStyle(() => ({
    height: composerHeight.value,
    borderRadius: interpolate(
      composerHeight.value,
      [PLANNER_CHAT_INPUT_MIN_HEIGHT, PLANNER_CHAT_INPUT_MAX_HEIGHT],
      [PLANNER_CHAT_INPUT_MIN_RADIUS, PLANNER_CHAT_INPUT_MAX_RADIUS],
      Extrapolation.CLAMP
    ),
  }));

  const innerSurfaceStyle = useAnimatedStyle(() => {
    const thinkingInset = 2 * thinkingProgress.value;

    return {
      top: thinkingInset,
      right: thinkingInset,
      bottom: thinkingInset,
      left: thinkingInset,
      borderRadius:
        interpolate(
          composerHeight.value,
          [PLANNER_CHAT_INPUT_MIN_HEIGHT, PLANNER_CHAT_INPUT_MAX_HEIGHT],
          [PLANNER_CHAT_INPUT_MIN_RADIUS, PLANNER_CHAT_INPUT_MAX_RADIUS],
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

  const getVisibleLines = useCallback(
    (contentHeight: number, oneLineContentHeight: number) => {
      const explicitLines = value.split('\n').length;
      // Native content heights drift by subpixels, so snap the delta to the nearest whole line.
      const measuredLineDelta = Math.round(
        (contentHeight - oneLineContentHeight) / PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT
      );
      const measuredLines = Math.max(1, 1 + measuredLineDelta);

      return Math.min(PLANNER_CHAT_INPUT_MAX_LINES, Math.max(explicitLines, measuredLines));
    },
    [value]
  );

  const handleControlSafeContentSizeChange = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = nativeEvent.contentSize.height;
      const explicitLines = value.split('\n').length;

      if (
        !hasCalibratedControlSafeOneLineContentHeight.current &&
        explicitLines === 1 &&
        contentHeight > 0 &&
        contentHeight < PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2
      ) {
        controlSafeOneLineContentHeight.current = contentHeight;
        hasCalibratedControlSafeOneLineContentHeight.current = true;
      }

      const controlSafeLines = getVisibleLines(
        contentHeight,
        controlSafeOneLineContentHeight.current
      );

      // This stable narrow input only decides whether text must move above the controls.
      // The unconstrained full-width measurement owns multiline viewport height.
      if (controlSafeLines === 1) {
        updateMultilineMode(false, PLANNER_CHAT_INPUT_MIN_HEIGHT);
      } else if (!isMultilineRef.current) {
        const nextHeight =
          PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
          PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
          multilineMeasurementLines.current * PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT;

        updateMultilineMode(true, nextHeight);
      }
    },
    [getVisibleLines, updateMultilineMode, value]
  );

  const handleMultilineMeasurementContentSizeChange = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = nativeEvent.contentSize.height;
      const explicitLines = value.split('\n').length;

      if (
        !hasCalibratedMultilineMeasurementOneLineContentHeight.current &&
        explicitLines === 1 &&
        contentHeight > 0 &&
        contentHeight < PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2
      ) {
        multilineMeasurementOneLineContentHeight.current = contentHeight;
        hasCalibratedMultilineMeasurementOneLineContentHeight.current = true;
      }

      const measuredLines = getVisibleLines(
        contentHeight,
        multilineMeasurementOneLineContentHeight.current
      );

      multilineMeasurementLines.current = measuredLines;
      if (!isMultilineRef.current) return;

      const heightForMeasuredLines =
        PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
        PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
        measuredLines * PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT;
      const nextHeight = Math.min(PLANNER_CHAT_INPUT_MAX_HEIGHT, heightForMeasuredLines);

      updateHeight(nextHeight);
    },
    [getVisibleLines, updateHeight, value]
  );

  const inputRightInset = hasText ? 104 : 56;
  const textAreaHorizontalInset = isMultiline
    ? PLANNER_CHAT_INPUT_MULTILINE_CONTENT_INSET
    : PLANNER_CHAT_INPUT_ONE_LINE_LEFT_INSET;
  const textInputHorizontalPadding = isMultiline ? 0 : 16;
  const textInputViewportHeight = isMultiline
    ? inputHeight - PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT - PLANNER_CHAT_INPUT_VERTICAL_INSET * 2
    : PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT;

  return (
    <Animated.View
      testID="planner-composer-wrapper"
      style={[
        styles.wrapper,
        {
          paddingBottom:
            insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT + PLANNER_CHAT_INPUT_CLEARANCE,
        },
        inputAnimatedStyle,
      ]}>
      <Animated.View
        testID="planner-composer-frame"
        style={[
          styles.frame,
          {
            borderCurve: 'continuous',
          },
          composerStyle,
        ]}
        onLayout={({ nativeEvent }) => {
          onRenderedHeightChange?.(nativeEvent.layout.height);
        }}>
        <Animated.View
          testID="planner-composer-thinking-gradient"
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
          testID="planner-composer-inner-surface"
          pointerEvents="none"
          style={[
            styles.innerSurface,
            {
              borderCurve: 'continuous',
            },
            innerSurfaceStyle,
          ]}>
          <Animated.View
            testID="planner-composer-surface"
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: theme.colorDark },
              surfaceTintStyle,
            ]}
          />
        </Animated.View>

        <View
          style={{
            position: 'absolute',
            top: isMultiline
              ? PLANNER_CHAT_INPUT_VERTICAL_INSET
              : PLANNER_CHAT_INPUT_CONTROL_TOP_OFFSET,
            bottom: isMultiline ? PLANNER_CHAT_INPUT_MULTILINE_TEXT_BOTTOM_OFFSET : undefined,
            right: isMultiline ? PLANNER_CHAT_INPUT_MULTILINE_CONTENT_INSET : inputRightInset,
            left: textAreaHorizontalInset,
          }}>
          {!value ? (
            <View
              testID="planner-composer-placeholder"
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                position: 'absolute',
                top: (PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT - 20) / 2,
                right: textInputHorizontalPadding,
                left: textInputHorizontalPadding,
              }}>
              <Text
                style={{
                  color: withOpacity(theme.textLight, 0.6),
                  fontSize: 15,
                  lineHeight: 20,
                }}>
                Decile a la IA lo que te gustaria
              </Text>
            </View>
          ) : null}
          <TextInput
            testID="planner-composer-input"
            value={value}
            onChangeText={onChangeText}
            editable
            multiline
            scrollEnabled={inputHeight >= PLANNER_CHAT_INPUT_MAX_HEIGHT}
            submitBehavior="newline"
            textAlignVertical={isMultiline ? 'top' : 'center'}
            style={{
              color: theme.appBg,
              fontSize: 17,
              height: textInputViewportHeight,
              lineHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
              paddingHorizontal: textInputHorizontalPadding,
              paddingVertical: 0,
            }}
          />
        </View>

        <View
          testID="planner-composer-multiline-measurement"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: PLANNER_CHAT_INPUT_VERTICAL_INSET,
            right: PLANNER_CHAT_INPUT_MULTILINE_CONTENT_INSET,
            left: PLANNER_CHAT_INPUT_MULTILINE_CONTENT_INSET,
            opacity: 0,
          }}>
          <TextInput
            testID="planner-composer-multiline-measurement-input"
            value={value}
            onContentSizeChange={handleMultilineMeasurementContentSizeChange}
            accessible={false}
            editable={false}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            style={{
              fontSize: 17,
              lineHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
              paddingHorizontal: 0,
              paddingVertical: 0,
            }}
          />
        </View>

        <View
          testID="planner-composer-control-safe-measurement"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: PLANNER_CHAT_INPUT_CONTROL_TOP_OFFSET,
            right: inputRightInset,
            left: PLANNER_CHAT_INPUT_ONE_LINE_LEFT_INSET,
            opacity: 0,
          }}>
          <TextInput
            testID="planner-composer-control-safe-input"
            value={value}
            onContentSizeChange={handleControlSafeContentSizeChange}
            accessible={false}
            editable={false}
            multiline
            scrollEnabled={false}
            style={{
              fontSize: 17,
              lineHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
              maxHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES,
              paddingHorizontal: 16,
              paddingVertical: 0,
            }}
          />
        </View>

        <View style={[styles.leftControl, { bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET, left: 8 }]}>
          <Pressable
            accessibilityLabel="Add meal detail"
            accessibilityRole="button"
            style={styles.controlButton}
            hitSlop={8}>
            <View style={{ transform: [{ translateY: PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y }] }}>
              <Plus size={24} color={theme.appBg} strokeWidth={2.5} />
            </View>
          </Pressable>
        </View>

        <View
          testID="planner-composer-controls"
          style={[styles.controls, { right: 8, bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET }]}>
          <Pressable
            accessibilityLabel="Voice input"
            accessibilityRole="button"
            style={styles.controlButton}
            hitSlop={8}>
            <View style={{ transform: [{ translateY: PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y }] }}>
              <Mic size={22} color={theme.appBg} strokeWidth={2} />
            </View>
          </Pressable>

          <Animated.View
            pointerEvents={hasText ? 'auto' : 'none'}
            style={[styles.sendContainer, sendContainerStyle]}>
            <Pressable
              testID="planner-composer-submit"
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={onSubmit}
              hitSlop={8}
              style={[styles.controlButton, { opacity: canSubmit ? 1 : 0.45 }]}>
              <View
                style={{ transform: [{ translateY: PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y }] }}>
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
  innerSurface: {
    overflow: 'hidden',
    position: 'absolute',
  },
  leftControl: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
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
