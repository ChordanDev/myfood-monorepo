import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { PlannerChatInput, PlannerHeader, PlannerTypingIndicator } from '../components';
import {
  CUSTOM_TAB_BAR_CONTENT_HEIGHT,
  PLANNER_CHAT_INPUT_CLEARANCE,
  PLANNER_CHAT_INPUT_MIN_HEIGHT,
} from '../constants';

interface PlannerMessage {
  id: string;
  author: 'assistant' | 'user';
  text: string;
}

interface PendingTurnAnchor {
  messageId: string;
  targetY: number | null;
  anchorAttempted: boolean;
}

const INITIAL_MESSAGES: PlannerMessage[] = [
  {
    id: 'request',
    author: 'user',
    text: 'EL domingo a la noche vienen 5 personas a mi casa y son vegetarianos. Despues el sabado tengo que preparar algo para llevar al a iglesia, para compartir pero son bastantes como 30 personas',
  },
  {
    id: 'suggestion',
    author: 'assistant',
    text: 'Te parece para el domingo hacer unos tacos vegetarianos? y para el sábado llevar unas empanadas de choclo y verdura?',
  },
  { id: 'confirmation', author: 'user', text: 'Si, me parece perfecto' },
];

const MOCK_ASSISTANT_RESPONSE_DELAY_MS = 10000;
const PLANNER_TURN_ANCHOR_TOP_INSET = 16;

export const PlannerScreen = () => {
  const { theme } = useRecipeTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const scrollViewRef = useRef<ScrollView>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollFrameRef = useRef<number | null>(null);
  const anchorFrameRef = useRef<number | null>(null);
  const pendingAnchorRef = useRef<PendingTurnAnchor | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const contentHeightRef = useRef(0);
  const scrollViewportHeightRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const isMountedRef = useRef(true);
  const [messages, setMessages] = useState<PlannerMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [composerHeight, setComposerHeight] = useState(PLANNER_CHAT_INPUT_MIN_HEIGHT);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);

  const contentBottomClearance =
    composerHeight +
    insets.bottom +
    CUSTOM_TAB_BAR_CONTENT_HEIGHT +
    PLANNER_CHAT_INPUT_CLEARANCE +
    28;
  const usableScrollViewportHeight = Math.max(0, scrollViewportHeight - contentBottomClearance);
  const trailingExtentHeight =
    activeTurnId === null
      ? 0
      : Math.max(0, usableScrollViewportHeight - PLANNER_TURN_ANCHOR_TOP_INSET);

  const cancelPendingScrollFrames = useCallback(() => {
    if (initialScrollFrameRef.current !== null) {
      cancelAnimationFrame(initialScrollFrameRef.current);
      initialScrollFrameRef.current = null;
    }
    if (anchorFrameRef.current !== null) {
      cancelAnimationFrame(anchorFrameRef.current);
      anchorFrameRef.current = null;
    }
  }, []);

  const scheduleSettledAnchor = useCallback(() => {
    const pendingAnchor = pendingAnchorRef.current;
    if (
      pendingAnchor === null ||
      pendingAnchor.anchorAttempted ||
      pendingAnchor.targetY === null ||
      scrollViewportHeightRef.current <= 0 ||
      contentHeightRef.current <
        Math.max(0, pendingAnchor.targetY - PLANNER_TURN_ANCHOR_TOP_INSET) +
          scrollViewportHeightRef.current ||
      activeTurnIdRef.current !== pendingAnchor.messageId ||
      anchorFrameRef.current !== null
    ) {
      return;
    }

    // onLayout/onContentSizeChange report calculated native geometry. The next frame is
    // the first boundary where the complete reachable content extent can be visibly committed.
    anchorFrameRef.current = requestAnimationFrame(() => {
      anchorFrameRef.current = null;
      if (
        !isMountedRef.current ||
        pendingAnchorRef.current !== pendingAnchor ||
        activeTurnIdRef.current !== pendingAnchor.messageId ||
        pendingAnchor.targetY === null ||
        contentHeightRef.current <
          Math.max(0, pendingAnchor.targetY - PLANNER_TURN_ANCHOR_TOP_INSET) +
            scrollViewportHeightRef.current
      ) {
        return;
      }

      const scrollView = scrollViewRef.current;
      if (scrollView === null) return;

      pendingAnchor.anchorAttempted = true;
      scrollView.scrollTo({
        y: Math.max(0, pendingAnchor.targetY - PLANNER_TURN_ANCHOR_TOP_INSET),
        animated: !reduceMotion,
      });
    });
  }, [reduceMotion]);

  const sendMessage = useCallback(() => {
    const message = input.trim();
    if (!message || isThinking) return;

    const messageId = `user-${Date.now()}`;
    cancelPendingScrollFrames();
    if (responseTimerRef.current !== null) {
      clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    contentHeightRef.current = 0;
    pendingAnchorRef.current = {
      messageId,
      targetY: null,
      anchorAttempted: false,
    };
    activeTurnIdRef.current = messageId;
    setActiveTurnId(messageId);
    setMessages([...messages, { id: messageId, author: 'user', text: message }]);
    setInput('');
    setIsThinking(true);

    responseTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-${Date.now()}`,
          author: 'assistant',
          text: 'Tomé tu pedido. ¿Querés que además te prepare una lista de compras?',
        },
      ]);
      setIsThinking(false);
      responseTimerRef.current = null;
    }, MOCK_ASSISTANT_RESPONSE_DELAY_MS);
  }, [cancelPendingScrollFrames, input, isThinking, messages]);

  const handleActiveTurnLayout = useCallback(
    (messageId: string, event: LayoutChangeEvent) => {
      const pendingAnchor = pendingAnchorRef.current;
      if (pendingAnchor === null || pendingAnchor.messageId !== messageId) return;

      pendingAnchor.targetY = event.nativeEvent.layout.y;
      scheduleSettledAnchor();
    },
    [scheduleSettledAnchor]
  );

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      scheduleSettledAnchor();
    },
    [scheduleSettledAnchor]
  );

  const handleScrollViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      scrollViewportHeightRef.current = height;
      setScrollViewportHeight(height);
      scheduleSettledAnchor();
    },
    [scheduleSettledAnchor]
  );

  const handleScrollBeginDrag = useCallback(() => {
    pendingAnchorRef.current = null;
    if (anchorFrameRef.current !== null) {
      cancelAnimationFrame(anchorFrameRef.current);
      anchorFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;

    initialScrollFrameRef.current = requestAnimationFrame(() => {
      initialScrollFrameRef.current = null;
      if (activeTurnIdRef.current !== null) return;
      scrollViewRef.current?.scrollToEnd({ animated: !reduceMotion });
    });
  }, [reduceMotion]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
      cancelPendingScrollFrames();
    };
  }, [cancelPendingScrollFrames]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <NoisyBackground opacity={0.3} />

      <PlannerHeader />

      <ScrollView
        ref={scrollViewRef}
        testID="planner-conversation-list"
        style={{ marginTop: 21, flex: 1, paddingHorizontal: 17.5 }}
        contentContainerStyle={{
          paddingBottom: contentBottomClearance,
          gap: 28,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={handleScrollViewportLayout}
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={handleScrollBeginDrag}>
        {messages.map((message) =>
          message.author === 'user' ? (
            <View
              key={message.id}
              testID={
                message.id === activeTurnId
                  ? 'planner-active-turn-message'
                  : message.id === 'request'
                    ? 'planner-initial-request-message'
                    : 'planner-user-message'
              }
              onLayout={
                message.id === activeTurnId
                  ? (event) => handleActiveTurnLayout(message.id, event)
                  : undefined
              }
              style={[styles.userMessage, { backgroundColor: theme.colorLight }]}>
              <Text style={[styles.userMessageText, { color: theme.textBlack }]}>
                {message.text}
              </Text>
            </View>
          ) : (
            <View key={message.id} style={styles.assistantMessage}>
              <Text style={[styles.assistantMessageText, { color: theme.textBlack }]}>
                {message.text}
              </Text>
            </View>
          )
        )}
        {isThinking ? <PlannerTypingIndicator /> : null}
        <View
          testID="planner-turn-trailing-space"
          pointerEvents="none"
          style={{ height: trailingExtentHeight }}
        />
      </ScrollView>

      <PlannerChatInput
        value={input}
        isThinking={isThinking}
        onChangeText={setInput}
        onHeightChange={setComposerHeight}
        onSubmit={sendMessage}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  assistantMessage: {
    maxWidth: '94%',
    paddingHorizontal: 3.5,
  },
  assistantMessageText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 26,
  },
  screen: {
    flex: 1,
  },
  userMessage: {
    alignSelf: 'flex-end',
    borderRadius: 21,
    borderTopRightRadius: 7,
    maxWidth: '92%',
    paddingHorizontal: 17.5,
    paddingVertical: 14,
  },
  userMessageText: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 26,
  },
});
