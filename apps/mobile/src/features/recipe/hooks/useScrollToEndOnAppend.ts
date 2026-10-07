import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * Follows the conversation: when a message or the typing indicator is appended, the list scrolls
 * to its end as soon as the new content has been measured. The room the keyboard takes under the
 * conversation counts as appended content too, so opening the keyboard scrolls to the end as well.
 *
 * @param keyboardLift How far the keyboard lifts the composer; the content is padded by it.
 */
export function useScrollToEndOnAppend(
  messageCount: number,
  isThinking: boolean,
  keyboardLift = 0
) {
  const scrollViewRef = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotion();
  const isScrollPendingRef = useRef(false);
  const previousCountRef = useRef(messageCount);
  const wasThinkingRef = useRef(isThinking);
  const previousLiftRef = useRef(keyboardLift);

  // A layout effect runs inside the commit, before the native size event of that commit can
  // reach JS, so the flag is always set by the time the new content size is reported.
  useLayoutEffect(() => {
    const hasAppended =
      messageCount > previousCountRef.current || (isThinking && !wasThinkingRef.current);

    // A keyboard that closes hands the room back; the list then settles on its own.
    const hasLifted = keyboardLift > previousLiftRef.current;

    previousCountRef.current = messageCount;
    wasThinkingRef.current = isThinking;
    previousLiftRef.current = keyboardLift;
    if (hasAppended || hasLifted) isScrollPendingRef.current = true;
  }, [isThinking, keyboardLift, messageCount]);

  const handleContentSizeChange = useCallback(() => {
    if (!isScrollPendingRef.current) return;

    isScrollPendingRef.current = false;
    scrollViewRef.current?.scrollToEnd({ animated: !reduceMotion });
  }, [reduceMotion]);

  return { scrollViewRef, handleContentSizeChange };
}
