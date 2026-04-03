import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const IOS_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
const ANDROID_EASING = Easing.out(Easing.cubic);

export function useKeyboardAnimation() {
  const isIOS = Platform.OS === 'ios';
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const keyboardProgress = useSharedValue(0);
  const keyboardHeight = useSharedValue(0);
  const FALLBACK_DURATION = isIOS ? 240 : 320;

  const formAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(keyboardProgress.value, [0, 1], [0, -keyboardHeight.value * 0.4]),
      },
    ],
  }));

  useEffect(() => {
    const getAnimationDuration = (value?: number) => {
      if (typeof value !== 'number' || Number.isNaN(value) || value <= 16) {
        return FALLBACK_DURATION;
      }

      const clampedDuration = Math.min(Math.max(value, 140), 320);

      if (!isIOS) {
        return Math.min(Math.round(clampedDuration * 1.45), 460);
      }

      return clampedDuration;
    };

    const showEvent = isIOS ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';
    const easing = isIOS ? IOS_EASING : ANDROID_EASING;

    const animateProgressTo = (toValue: number, duration = FALLBACK_DURATION) => {
      cancelAnimation(keyboardProgress);

      keyboardProgress.value = withTiming(toValue, {
        duration,
        easing,
      });
    };

    const animateHeightTo = (toValue: number, duration = FALLBACK_DURATION) => {
      cancelAnimation(keyboardHeight);

      keyboardHeight.value = withTiming(toValue, {
        duration,
        easing,
      });
    };

    const animateKeyboard = (height: number, isOpen: boolean, duration = FALLBACK_DURATION) => {
      if (isOpen) {
        animateHeightTo(height, duration);
      }

      setIsKeyboardOpen(isOpen);
      animateProgressTo(isOpen ? 1 : 0, duration);
    };

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const height = event.endCoordinates.height;
      const duration = getAnimationDuration(event.duration);

      animateKeyboard(height, height > 0, duration);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      const duration = getAnimationDuration(event.duration);

      animateKeyboard(0, false, duration);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [FALLBACK_DURATION, isIOS, keyboardHeight, keyboardProgress]);

  return {
    formAnimatedStyle,
    isKeyboardOpen,
  };
}
