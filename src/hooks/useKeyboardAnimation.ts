import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Platform } from 'react-native';

export function useKeyboardAnimation() {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardProgress = useRef(new Animated.Value(0)).current;
  const formShift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const FALLBACK_DURATION = Platform.OS === 'android' ? 180 : 220;

    const getAnimationDuration = (value?: number) => {
      if (typeof value !== 'number' || Number.isNaN(value) || value <= 16) {
        return FALLBACK_DURATION;
      }

      return value;
    };

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const animateTo = (toValue: number, duration = FALLBACK_DURATION) => {
      Animated.timing(keyboardProgress, {
        toValue,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    const animateShiftTo = (toValue: number, duration = FALLBACK_DURATION) => {
      if (Platform.OS === 'android') {
        Animated.spring(formShift, {
          toValue,
          damping: 18,
          stiffness: 220,
          mass: 0.7,
          overshootClamping: true,
          useNativeDriver: true,
        }).start();

        return;
      }

      Animated.timing(formShift, {
        toValue,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      setIsKeyboardOpen(true);

      const duration = getAnimationDuration(event.duration);
      const targetShift =
        Platform.OS === 'android'
          ? -(event.endCoordinates.height / 2.8)
          : -(event.endCoordinates.height / 2.5);

      keyboardProgress.stopAnimation();
      formShift.stopAnimation();

      animateTo(1, duration);
      animateShiftTo(targetShift, duration);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      setIsKeyboardOpen(false);

      const duration = getAnimationDuration(event.duration);

      keyboardProgress.stopAnimation();
      formShift.stopAnimation();

      animateTo(0, duration);
      animateShiftTo(0, duration);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [formShift, keyboardProgress]);

  return {
    keyboardProgress,
    formShift,
    isKeyboardOpen,
    keyboardHeight,
  };
}
