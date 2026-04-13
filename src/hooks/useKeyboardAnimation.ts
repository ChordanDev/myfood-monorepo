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

interface KeyboardAnimationOptions {
  liftFactor?: number;
  durationScale?: number;
  fallbackDuration?: number;
  enabled?: boolean;
}

export function useKeyboardAnimation(options?: KeyboardAnimationOptions) {
  const isIOS = Platform.OS === 'ios';
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const keyboardProgress = useSharedValue(0);
  const keyboardHeight = useSharedValue(0);
  const liftFactor = options?.liftFactor ?? 0.4;
  const durationScale = options?.durationScale ?? 1;
  const fallbackDuration = options?.fallbackDuration ?? (isIOS ? 240 : 320);
  const enabled = options?.enabled ?? true;

  const inputAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        // Mueve el contenido hacia arriba en proporcion a la altura del teclado.
        translateY: interpolate(
          keyboardProgress.value,
          [0, 1],
          [0, -keyboardHeight.value * liftFactor]
        ),
      },
    ],
  }));

  useEffect(() => {
    if (!enabled) {
      setIsKeyboardOpen(false);
      cancelAnimation(keyboardProgress);
      cancelAnimation(keyboardHeight);
      keyboardProgress.value = 0;
      keyboardHeight.value = 0;
      return;
    }

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

    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const frameEvent = isIOS ? 'keyboardWillChangeFrame' : null;
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';
    const easing = isIOS ? IOS_EASING : ANDROID_EASING;

    const animateProgressTo = (toValue: number, duration = fallbackDuration) => {
      cancelAnimation(keyboardProgress);

      keyboardProgress.value = withTiming(toValue, {
        duration,
        easing,
      });
    };

    const animateHeightTo = (toValue: number, duration = fallbackDuration) => {
      cancelAnimation(keyboardHeight);

      keyboardHeight.value = withTiming(toValue, {
        duration,
        easing,
      });
    };

    const animateKeyboard = (height: number, isOpen: boolean, duration = fallbackDuration) => {
      if (isOpen) {
        animateHeightTo(height, duration);
      } else {
        animateHeightTo(0, duration);
      }

      setIsKeyboardOpen(isOpen);
      animateProgressTo(isOpen ? 1 : 0, duration);
    };

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const height = event.endCoordinates.height;
      const duration = getAnimationDuration(event.duration);

      // En iOS el evento tambien entrega duraciones fiables.
      animateKeyboard(height, height > 0, duration);
    });

    const frameSubscription = frameEvent
      ? Keyboard.addListener(frameEvent, (event) => {
          const height = event.endCoordinates.height;
          const duration = getAnimationDuration(event.duration);

          animateKeyboard(height, height > 0, duration);
        })
      : null;

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      const duration = getAnimationDuration(event.duration);

      animateKeyboard(0, false, duration);
    });

    return () => {
      showSubscription.remove();
      frameSubscription?.remove();
      hideSubscription.remove();
    };
  }, [durationScale, enabled, fallbackDuration, isIOS, keyboardHeight, keyboardProgress]);

  return {
    inputAnimatedStyle,
    isKeyboardOpen,
  };
}
