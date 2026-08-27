import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, ScrollView, Text, View } from 'react-native';
import { NoisyBackground } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlannerHeader, PlannerChatInput, PlannerTypingIndicator } from '../components';
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

const MOCK_ASSISTANT_RESPONSE_DELAY_MS = 3000;

export const PlannerScreen = () => {
  const { theme } = useRecipeTheme();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollContentRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [composerHeight, setComposerHeight] = useState(PLANNER_CHAT_INPUT_MIN_HEIGHT);

  const scrollToLatest = useCallback(() => {
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const queueScrollForContent = useCallback((contentKey: string) => {
    pendingScrollContentRef.current = contentKey;
  }, []);

  const scrollAfterContentLayout = useCallback(
    (contentKey: string) => {
      if (pendingScrollContentRef.current !== contentKey) return;

      pendingScrollContentRef.current = null;
      scrollToLatest();
    },
    [scrollToLatest]
  );

  const sendMessage = useCallback(() => {
    const message = input.trim();
    if (!message || isThinking) return;

    setMessages((currentMessages) => [
      ...currentMessages,
      { id: `user-${Date.now()}`, author: 'user', text: message },
    ]);
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
  }, [input, isThinking]);

  const latestContentKey = isThinking ? 'typing' : messages.at(-1)?.id;

  useEffect(() => {
    if (!latestContentKey) return;

    queueScrollForContent(latestContentKey);
    scrollToLatest();
  }, [latestContentKey, queueScrollForContent, scrollToLatest]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: theme.appBg }}>
      <NoisyBackground opacity={0.3} />

      <PlannerHeader />

      <ScrollView
        ref={scrollViewRef}
        className="mt-6 flex-1 px-5"
        contentContainerStyle={{
          paddingBottom:
            composerHeight +
            insets.bottom +
            CUSTOM_TAB_BAR_CONTENT_HEIGHT +
            PLANNER_CHAT_INPUT_CLEARANCE +
            28,
          gap: 28,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (latestContentKey) scrollAfterContentLayout(latestContentKey);
        }}>
        {messages.map((message) =>
          message.author === 'user' ? (
            <View
              key={message.id}
              className="max-w-[92%] self-end rounded-3xl rounded-tr-lg px-5 py-4"
              style={{ backgroundColor: theme.colorLight }}>
              <Text
                className="text-[16px] font-medium leading-relaxed"
                style={{ color: theme.textBlack }}>
                {message.text}
              </Text>
            </View>
          ) : (
            <View
              key={message.id}
              className="max-w-[94%] px-1"
              onLayout={
                message.id === latestContentKey
                  ? (_event: LayoutChangeEvent) => scrollAfterContentLayout(message.id)
                  : undefined
              }>
              <Text
                className="text-[16px] font-bold leading-relaxed"
                style={{ color: theme.textBlack }}>
                {message.text}
              </Text>
            </View>
          )
        )}
        {isThinking ? (
          <PlannerTypingIndicator onLayout={() => scrollAfterContentLayout('typing')} />
        ) : null}
      </ScrollView>

      <PlannerChatInput
        value={input}
        isThinking={isThinking}
        onChangeText={setInput}
        onHeightChange={setComposerHeight}
        onRenderedHeightChange={setComposerHeight}
        onSubmit={sendMessage}
      />
    </View>
  );
};
