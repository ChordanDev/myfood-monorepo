import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import { askCookingSession, getCookingSession, startCookingSession } from '@/features/cooking';
import {
  createPendingUserMessage,
  mergeChatHistory,
  reconcileChatTurns,
  type RecipeChatAvailability,
  type RecipeChatMessage,
} from '../domain/recipeChat';

type UseRecipeChatArgs = {
  /** The planned meal the chat belongs to; `null` when the recipe was opened without one. */
  scheduledMealId: string | null;
  /** The chat only works on the day the meal is planned. */
  isEnabled: boolean;
  /** A cooked meal has finished its Cooking session: the conversation stays, nothing is asked. */
  isCooked: boolean;
};

/** Why the server closed the chat; it stays closed for as long as the screen shows this meal. */
type ClosedReason = Exclude<RecipeChatAvailability, 'available'>;

type ChatState = {
  /** The meal this state belongs to: a state left by another meal reads as an empty one. */
  mealId: string | null;
  messages: RecipeChatMessage[];
  isThinking: boolean;
  closedReason: ClosedReason | null;
  errorMessage: string | null;
};

const NO_MESSAGES: RecipeChatMessage[] = [];

function emptyChat(mealId: string | null): ChatState {
  return {
    mealId,
    messages: NO_MESSAGES,
    isThinking: false,
    closedReason: null,
    errorMessage: null,
  };
}

function closedReasonOf(error: unknown): ClosedReason | null {
  if (!isApiError(error)) return null;
  if (error.code === 'cooking_chat_unavailable') return 'unavailable';
  if (error.code === 'cooking_already_finished') return 'finished';
  return null;
}

/** A refusal that closes the chat is told by the composer; any other failure says why. */
function withFailure(chat: ChatState, error: unknown): ChatState {
  const closedReason = closedReasonOf(error);

  return closedReason
    ? { ...chat, closedReason, errorMessage: null }
    : { ...chat, errorMessage: getAuthErrorMessage(error) };
}

/**
 * Conversation with the Cooking chat of a planned meal. The server keeps it: opening the chat
 * starts (or finds) the meal's Cooking session and reads its history, and every question is
 * answered and stored there. A chat that is not available makes no request.
 */
export function useRecipeChat({ scheduledMealId, isEnabled, isCooked }: UseRecipeChatArgs) {
  const [chat, setChat] = useState(() => emptyChat(scheduledMealId));
  const [input, setInput] = useState('');
  // The meal on screen, `null` once the screen left: an answer for any other meal is dropped.
  const activeMealIdRef = useRef<string | null>(null);
  // One opening per meal, shared by the mount and by a question sent before it settled.
  const openingRef = useRef<{ mealId: string; sessionId: Promise<string> } | null>(null);
  // State lags a render behind: the ref is what stops a second submit from asking twice.
  const isAskingRef = useRef(false);
  const pendingCountRef = useRef(0);

  const current = chat.mealId === scheduledMealId ? chat : emptyChat(scheduledMealId);
  const canOpen = isEnabled && !isCooked && scheduledMealId !== null;

  let availability: RecipeChatAvailability = current.closedReason ?? 'available';
  if (!isEnabled || scheduledMealId === null) availability = 'unavailable';
  else if (isCooked) availability = 'finished';

  const updateChat = useCallback((mealId: string, change: (chat: ChatState) => ChatState) => {
    if (activeMealIdRef.current !== mealId) return;

    setChat((latest) => change(latest.mealId === mealId ? latest : emptyChat(mealId)));
  }, []);

  const openSession = useCallback(
    (mealId: string): Promise<string> => {
      if (openingRef.current?.mealId === mealId) return openingRef.current.sessionId;

      const sessionId = (async () => {
        const started = await startCookingSession(mealId);
        // The read is what brings the history back after the app was closed.
        const session = await getCookingSession(started.sessionId);

        updateChat(mealId, (latest) => ({
          ...latest,
          messages: mergeChatHistory(session.chatMessages, latest.messages),
          errorMessage: null,
        }));
        return session.sessionId;
      })();

      openingRef.current = { mealId, sessionId };
      // A failed opening is forgotten, so the next question tries again.
      sessionId.catch(() => {
        if (openingRef.current?.sessionId === sessionId) openingRef.current = null;
      });

      return sessionId;
    },
    [updateChat]
  );

  useEffect(() => {
    activeMealIdRef.current = scheduledMealId;

    if (canOpen) {
      openSession(scheduledMealId).catch((error: unknown) => {
        updateChat(scheduledMealId, (latest) => withFailure(latest, error));
      });
    }

    return () => {
      activeMealIdRef.current = null;
    };
  }, [canOpen, openSession, scheduledMealId, updateChat]);

  const ask = useCallback(
    async (mealId: string, pendingId: string, question: string) => {
      try {
        const sessionId = await openSession(mealId);
        const answer = await askCookingSession(sessionId, question);

        updateChat(mealId, (latest) => ({
          ...latest,
          messages: reconcileChatTurns(latest.messages, pendingId, answer.turns),
          isThinking: false,
        }));
      } catch (error) {
        updateChat(mealId, (latest) =>
          withFailure(
            {
              ...latest,
              messages: latest.messages.filter((message) => message.id !== pendingId),
              isThinking: false,
            },
            error
          )
        );
        // The question goes back to the composer unless the chat closed or the user moved on.
        if (activeMealIdRef.current === mealId && closedReasonOf(error) === null) {
          setInput((typed) => (typed === '' ? question : typed));
        }
      } finally {
        isAskingRef.current = false;
      }
    },
    [openSession, updateChat]
  );

  const sendMessage = useCallback(() => {
    const question = input.trim();
    if (availability !== 'available' || scheduledMealId === null) return;
    if (isAskingRef.current || question === '') return;

    isAskingRef.current = true;
    pendingCountRef.current += 1;
    const pendingId = `pending-${pendingCountRef.current}`;

    updateChat(scheduledMealId, (latest) => ({
      ...latest,
      messages: [...latest.messages, createPendingUserMessage(pendingId, question)],
      isThinking: true,
      errorMessage: null,
    }));
    setInput('');
    void ask(scheduledMealId, pendingId, question);
  }, [ask, availability, input, scheduledMealId, updateChat]);

  return {
    messages: current.messages,
    input,
    isThinking: current.isThinking,
    availability,
    errorMessage: current.errorMessage,
    setInput,
    sendMessage,
  };
}
