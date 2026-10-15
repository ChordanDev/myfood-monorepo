import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthErrorMessage, isApiError } from '@/api/errors';
import {
  askCookingSession,
  getCookingSession,
  startCookingSession,
  type CookingChatMessage,
} from '@/features/cooking';
import { newRequestId } from '@/services/requestId';
import {
  createPendingUserMessage,
  hasUnseenQuestion,
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

/** A question on its way, with the id that lets the server tell a resend from a new question. */
type Question = { pendingId: string; text: string; clientMessageId: string };

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

/** Refused before anything is stored, without closing the chat: the next day it asks again. */
function isLimitReached(error: unknown): boolean {
  return isApiError(error) && error.code === 'cooking_chat_limit_reached';
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
 * answered and stored there. A cooked meal opens its finished session, so the conversation is
 * shown closed. A chat that is not on the meal's day makes no request.
 */
export function useRecipeChat({ scheduledMealId, isEnabled, isCooked }: UseRecipeChatArgs) {
  const [chat, setChat] = useState(() => emptyChat(scheduledMealId));
  const [input, setInput] = useState('');
  // The meal on screen, `null` once the screen left: an answer for any other meal is dropped.
  const activeMealIdRef = useRef<string | null>(null);
  // One opening per meal, shared by the mount and by a question sent before it settled.
  const openingRef = useRef<{ mealId: string; sessionId: Promise<string> } | null>(null);
  // State lags a render behind: the ref is what stops a second submit from asking twice. It
  // holds the meals with a question on its way, so the pending answer of a meal the screen left
  // does not block the one it shows now.
  const askingMealIdsRef = useRef(new Set<string>());
  const pendingCountRef = useRef(0);
  // Every stored turn the server sent: a turn outside it is news after a failed question.
  const seenTurnIdsRef = useRef(new Set<string>());
  // The last question that failed without being stored: the same text is resent with its id.
  const retryRef = useRef<{ mealId: string; text: string; clientMessageId: string } | null>(null);

  const current = chat.mealId === scheduledMealId ? chat : emptyChat(scheduledMealId);
  const canOpen = isEnabled && scheduledMealId !== null;

  let availability: RecipeChatAvailability = current.closedReason ?? 'available';
  if (!isEnabled || scheduledMealId === null) availability = 'unavailable';
  else if (isCooked) availability = 'finished';

  const updateChat = useCallback((mealId: string, change: (chat: ChatState) => ChatState) => {
    if (activeMealIdRef.current !== mealId) return;

    setChat((latest) => change(latest.mealId === mealId ? latest : emptyChat(mealId)));
  }, []);

  const rememberTurns = useCallback((turns: CookingChatMessage[]) => {
    turns.forEach((turn) => seenTurnIdsRef.current.add(turn.id));
  }, []);

  const openSession = useCallback(
    (mealId: string): Promise<string> => {
      if (openingRef.current?.mealId === mealId) return openingRef.current.sessionId;

      const sessionId = (async () => {
        const started = await startCookingSession(mealId);
        // The read is what brings the history back after the app was closed.
        const session = await getCookingSession(started.sessionId);

        rememberTurns(session.chatMessages);
        updateChat(mealId, (latest) => ({
          ...latest,
          messages: mergeChatHistory(session.chatMessages, latest.messages),
          // The finished session of a cooked meal: its history is shown, nothing is asked.
          closedReason: session.status === 'completed' ? 'finished' : latest.closedReason,
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
    [rememberTurns, updateChat]
  );

  // After a failed question: the stored history when the server kept the question after all
  // (only its answer was lost on the way back), `null` when it did not or cannot be asked.
  // The question is found by the id it was sent with.
  const readStoredQuestion = useCallback(
    async (sessionId: string, clientMessageId: string): Promise<CookingChatMessage[] | null> => {
      try {
        const { chatMessages } = await getCookingSession(sessionId);
        if (!hasUnseenQuestion(chatMessages, seenTurnIdsRef.current, clientMessageId)) {
          return null;
        }

        rememberTurns(chatMessages);
        return chatMessages;
      } catch {
        return null;
      }
    },
    [rememberTurns]
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
    async (mealId: string, { pendingId, text, clientMessageId }: Question) => {
      const withoutPending = (messages: RecipeChatMessage[]) =>
        messages.filter((message) => message.id !== pendingId);
      let sessionId: string | null = null;

      try {
        sessionId = await openSession(mealId);
        const answer = await askCookingSession(sessionId, text, clientMessageId);

        rememberTurns(answer.turns);
        updateChat(mealId, (latest) => ({
          ...latest,
          messages: reconcileChatTurns(latest.messages, pendingId, answer.turns),
          isThinking: false,
        }));
      } catch (error) {
        const isRefusal = closedReasonOf(error) !== null;
        // A refusal stored nothing, and neither did the daily limit or a session that never
        // opened.
        const stored =
          isRefusal || isLimitReached(error) || sessionId === null
            ? null
            : await readStoredQuestion(sessionId, clientMessageId);

        if (stored) {
          updateChat(mealId, (latest) => ({
            ...latest,
            messages: mergeChatHistory(stored, withoutPending(latest.messages)),
            isThinking: false,
          }));
          return;
        }

        updateChat(mealId, (latest) =>
          withFailure(
            { ...latest, messages: withoutPending(latest.messages), isThinking: false },
            error
          )
        );
        // The question goes back to the composer unless the chat closed or the user moved on.
        if (activeMealIdRef.current === mealId && !isRefusal) {
          retryRef.current = { mealId, text, clientMessageId };
          setInput((typed) => (typed === '' ? text : typed));
        }
      } finally {
        askingMealIdsRef.current.delete(mealId);
      }
    },
    [openSession, readStoredQuestion, rememberTurns, updateChat]
  );

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (availability !== 'available' || scheduledMealId === null) return;
    if (askingMealIdsRef.current.has(scheduledMealId) || text === '') return;

    askingMealIdsRef.current.add(scheduledMealId);
    pendingCountRef.current += 1;
    const pendingId = `pending-${pendingCountRef.current}`;
    const retry = retryRef.current;
    const isResend = retry?.mealId === scheduledMealId && retry.text === text;
    const clientMessageId = isResend ? retry.clientMessageId : newRequestId();
    retryRef.current = null;

    updateChat(scheduledMealId, (latest) => ({
      ...latest,
      messages: [...latest.messages, createPendingUserMessage(pendingId, text)],
      isThinking: true,
      errorMessage: null,
    }));
    setInput('');
    void ask(scheduledMealId, { pendingId, text, clientMessageId });
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
