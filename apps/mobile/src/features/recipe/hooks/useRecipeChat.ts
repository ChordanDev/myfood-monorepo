import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildAssistantReply,
  createAssistantMessage,
  createUserMessage,
  resolveQuickAction,
  type RecipeChatAction,
  type RecipeChatMessage,
  type RecipeChatOffer,
} from '../domain/recipeChat';
import type { RecipeIngredientRow } from '../domain/recipeIngredients';

/** Stand-in for the latency of the real assistant. */
export const RECIPE_CHAT_REPLY_DELAY_MS = 1200;

type UseRecipeChatArgs = {
  recipeName: string;
  /** Ingredient rows of the recipe; the assistant offers the ones the inventory is short of. */
  rows: RecipeIngredientRow[];
  /** The chat only works on the day the meal is planned. */
  isEnabled: boolean;
  /**
   * Called when the user accepts an offer to send an ingredient to the shopping list. Without
   * it an accepted offer would go nowhere, so the assistant makes none.
   */
  onAddOffer?: (offer: RecipeChatOffer) => void;
};

/** Conversation with the cooking assistant. It lives only while the screen is mounted. */
export function useRecipeChat({ recipeName, rows, isEnabled, onAddOffer }: UseRecipeChatArgs) {
  const [messages, setMessages] = useState<RecipeChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnCountRef = useRef(0);
  const canOffer = onAddOffer !== undefined;
  // The reply is built when it arrives, so it reads the stock as it is by then.
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    return () => {
      if (replyTimerRef.current !== null) clearTimeout(replyTimerRef.current);
    };
  }, []);

  const sendMessage = useCallback(() => {
    const question = input.trim();
    if (!isEnabled || isThinking || question === '') return;

    turnCountRef.current += 1;
    const turnId = `turn-${turnCountRef.current}`;

    setMessages((current) => [...current, createUserMessage(`${turnId}-user`, question)]);
    setInput('');
    setIsThinking(true);

    replyTimerRef.current = setTimeout(() => {
      replyTimerRef.current = null;
      const reply = buildAssistantReply({
        question,
        recipeName,
        rows: rowsRef.current,
        canOffer,
      });

      setMessages((current) => [...current, createAssistantMessage(`${turnId}-assistant`, reply)]);
      setIsThinking(false);
    }, RECIPE_CHAT_REPLY_DELAY_MS);
  }, [canOffer, input, isEnabled, isThinking, recipeName]);

  const answerQuickAction = useCallback(
    (messageId: string, actionId: RecipeChatAction['id']) => {
      const result = resolveQuickAction(messages, messageId, actionId);
      // An answered message has no quick actions left, so the conversation comes back untouched.
      if (result.messages === messages) return;

      setMessages(result.messages);
      if (result.offerToAdd) onAddOffer?.(result.offerToAdd);
    },
    [messages, onAddOffer]
  );

  return { messages, input, isThinking, setInput, sendMessage, answerQuickAction };
}
