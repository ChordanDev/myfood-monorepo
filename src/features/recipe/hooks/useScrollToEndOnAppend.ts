import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * Follows the conversation: when a message or the typing indicator is appended, the list scrolls
 * to its end as soon as the new content has been measured.
 */
export function useScrollToEndOnAppend(messageCount: number, isThinking: boolean) {
  const scrollViewRef = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotion();
  const isScrollPendingRef = useRef(false);
  const previousCountRef = useRef(messageCount);
  const wasThinkingRef = useRef(isThinking);

  // A layout effect runs inside the commit, before the native size event of that commit can
  // reach JS, so the flag is always set by the time the new content size is reported.
  useLayoutEffect(() => {
    const hasAppended =
      messageCount > previousCountRef.current || (isThinking && !wasThinkingRef.current);

    previousCountRef.current = messageCount;
    wasThinkingRef.current = isThinking;
    if (hasAppended) isScrollPendingRef.current = true;
  }, [isThinking, messageCount]);

  const handleContentSizeChange = useCallback(() => {
    if (!isScrollPendingRef.current) return;

    isScrollPendingRef.current = false;
    scrollViewRef.current?.scrollToEnd({ animated: !reduceMotion });
  }, [reduceMotion]);

  return { scrollViewRef, handleContentSizeChange };
}
