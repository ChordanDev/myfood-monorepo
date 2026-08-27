import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform, useWindowDimensions } from 'react-native';
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const IOS_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
const ANDROID_EASING = Easing.out(Easing.cubic);

interface KeyboardAnimationCommonOptions {
  durationScale?: number;
  fallbackDuration?: number;
  enabled?: boolean;
}

export interface GeometryKeyboardAnimationOptions extends KeyboardAnimationCommonOptions {
  mode: 'geometry';
  restingBottomOffset: number;
  clearance?: number;
  liftFactor?: never;
}

export interface ProportionalKeyboardAnimationOptions extends KeyboardAnimationCommonOptions {
  mode: 'proportional';
  liftFactor?: number;
  restingBottomOffset?: never;
  clearance?: never;
}

export type KeyboardAnimationOptions =
  | GeometryKeyboardAnimationOptions
  | ProportionalKeyboardAnimationOptions;

export interface BottomAnchoredKeyboardGeometry {
  closedWindowHeight: number;
  restingBottomOffset: number;
  keyboardTop: number;
  clearance?: number;
}

export function calculateBottomAnchoredKeyboardLift({
  closedWindowHeight,
  restingBottomOffset,
  keyboardTop,
  clearance = 0,
}: BottomAnchoredKeyboardGeometry) {
  if (![closedWindowHeight, restingBottomOffset, keyboardTop, clearance].every(Number.isFinite)) {
    return 0;
  }

  const targetBottom = closedWindowHeight - restingBottomOffset;
  return Math.max(0, targetBottom + clearance - keyboardTop);
}

export function useKeyboardAnimation(options: KeyboardAnimationOptions) {
  const isIOS = Platform.OS === 'ios';
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const keyboardLift = useSharedValue(0);
  const keyboardOpenRef = useRef(false);
  const closedWindowMetricsRef = useRef({ width: windowWidth, height: windowHeight });
  const mode = options.mode;
  const restingBottomOffset = mode === 'geometry' ? options.restingBottomOffset : 0;
  const clearance = mode === 'geometry' ? (options.clearance ?? 0) : 0;
  const liftFactor = mode === 'proportional' ? (options.liftFactor ?? 0.4) : 0;
  const durationScale = options.durationScale ?? 1;
  const fallbackDuration = options.fallbackDuration ?? (isIOS ? 240 : 320);
  const enabled = options.enabled ?? true;

  const inputAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardLift.value === 0 ? 0 : -keyboardLift.value }],
  }));

  useEffect(() => {
    if (keyboardOpenRef.current) return;

    const closedMetrics = closedWindowMetricsRef.current;
    const isPendingAndroidResize =
      !isIOS && windowWidth === closedMetrics.width && windowHeight < closedMetrics.height;

    if (!isPendingAndroidResize) {
      closedWindowMetricsRef.current = { width: windowWidth, height: windowHeight };
    }
  }, [isIOS, windowHeight, windowWidth]);

  useEffect(() => {
    const easing = isIOS ? IOS_EASING : ANDROID_EASING;

    const getAnimationDuration = (value?: number) => {
      if (typeof value !== 'number' || Number.isNaN(value) || value <= 16) {
        return Math.round(fallbackDuration * durationScale);
      }

      const clampedDuration = Math.min(Math.max(value, 140), 320);

      if (!isIOS) {
        return Math.min(Math.round(clampedDuration * 1.45 * durationScale), 520);
      }

      return Math.round(clampedDuration * durationScale);
    };

    const animateLiftTo = (lift: number, duration = fallbackDuration) => {
      cancelAnimation(keyboardLift);
      keyboardLift.value = withTiming(Math.max(0, lift), { duration, easing });
    };

    const resetDisabled = () => {
      keyboardOpenRef.current = false;
      setIsKeyboardOpen(false);
      cancelAnimation(keyboardLift);
      keyboardLift.value = 0;
    };

    if (!enabled) {
      resetDisabled();
      return;
    }

    const animateForEvent = (event: KeyboardEvent, forceHidden = false) => {
      const { height, screenY: keyboardTop } = event.endCoordinates;
      const duration = getAnimationDuration(event.duration);
      const isOpen = !forceHidden && height > 0;
      let commandedLift = 0;

      keyboardOpenRef.current = isOpen;
      setIsKeyboardOpen(isOpen);

      if (isOpen) {
        if (mode === 'proportional') {
          commandedLift = height * liftFactor;
        } else {
          commandedLift = calculateBottomAnchoredKeyboardLift({
            closedWindowHeight: closedWindowMetricsRef.current.height,
            restingBottomOffset,
            keyboardTop,
            clearance,
          });
        }
      }

      animateLiftTo(commandedLift, duration);
    };

    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const frameEvent = isIOS ? 'keyboardWillChangeFrame' : null;
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, (event) => animateForEvent(event));
    const frameSubscription = frameEvent
      ? Keyboard.addListener(frameEvent, (event) => animateForEvent(event))
      : null;
    const hideSubscription = Keyboard.addListener(hideEvent, (event) =>
      animateForEvent(event, true)
    );

    return () => {
      showSubscription.remove();
      frameSubscription?.remove();
      hideSubscription.remove();
    };
  }, [
    clearance,
    durationScale,
    enabled,
    fallbackDuration,
    isIOS,
    keyboardLift,
    liftFactor,
    mode,
    restingBottomOffset,
  ]);

  return {
    inputAnimatedStyle,
    isKeyboardOpen,
  };
}
