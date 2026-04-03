import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export function useKeyboardAnimation() {
  const isIOS = Platform.OS === 'ios';
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardProgress = useSharedValue(0);
  const formShift = useSharedValue(0);
  const formAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: formShift.value }],
  }));

  useEffect(() => {
    const FALLBACK_DURATION = isIOS ? 240 : 200;
    const IOS_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);

    const getAnimationDuration = (value?: number) => {
      if (typeof value !== 'number' || Number.isNaN(value) || value <= 16) {
        return FALLBACK_DURATION;
      }

      return Math.min(Math.max(value, 140), 320);
    };

    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    const animateTo = (toValue: number, duration = FALLBACK_DURATION) => {
      keyboardProgress.value = withTiming(toValue, {
        duration,
        easing: isIOS ? IOS_EASING : Easing.out(Easing.cubic),
      });
    };

    const animateShiftTo = (toValue: number, duration = FALLBACK_DURATION) => {
      if (!isIOS) {
        formShift.value = withSpring(toValue, {
          damping: 20,
          stiffness: 170,
          mass: 0.8,
          overshootClamping: true,
        });

        return;
      }

      formShift.value = withTiming(toValue, {
        duration,
        easing: IOS_EASING,
      });
    };

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      setIsKeyboardOpen(true);

      const duration = getAnimationDuration(event.duration);
      const targetShift = isIOS
        ? -(event.endCoordinates.height / 2.75)
        : -(event.endCoordinates.height / 3);

      cancelAnimation(keyboardProgress);
      cancelAnimation(formShift);

      animateTo(1, duration);
      animateShiftTo(targetShift, duration);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      setIsKeyboardOpen(false);
      setKeyboardHeight(0);

      const duration = getAnimationDuration(event.duration);

      cancelAnimation(keyboardProgress);
      cancelAnimation(formShift);

      animateTo(0, duration);
      animateShiftTo(0, duration);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [formShift, isIOS, keyboardProgress]);

  return {
    keyboardProgress,
    formShift,
    formAnimatedStyle,
    isKeyboardOpen,
    keyboardHeight,
  };
}
