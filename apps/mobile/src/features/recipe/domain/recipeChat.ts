import type { CookingChatMessage } from '@/features/cooking';

export type RecipeChatMessage = {
  /** The server id of a stored turn; a question still on its way has a local one. */
  id: string;
  author: 'assistant' | 'user';
  text: string;
};

/**
 * Whether the user can ask: the chat works on the day the meal is planned (`unavailable` on any
 * other day or without a planned meal) and ends once the meal is cooked (`finished`).
 */
export type RecipeChatAvailability = 'available' | 'unavailable' | 'finished';

const RECIPE_CHAT_PLACEHOLDERS: Record<RecipeChatAvailability, string> = {
  available: 'Preguntale a la IA sobre la receta',
  unavailable: 'Chat disponible el día de la receta',
  finished: 'Chat cerrado: la comida ya está cocinada',
};

/** The hint of the composer; on a closed chat it says why nothing can be asked. */
export function recipeChatPlaceholder(availability: RecipeChatAvailability): string {
  return RECIPE_CHAT_PLACEHOLDERS[availability];
}

export function toRecipeChatMessage(turn: CookingChatMessage): RecipeChatMessage {
  return { id: turn.id, author: turn.role, text: turn.content };
}

/** The question as the user sees it while the server has not stored it yet. */
export function createPendingUserMessage(id: string, text: string): RecipeChatMessage {
  return { id, author: 'user', text };
}

function appendUnseen(
  messages: RecipeChatMessage[],
  additions: RecipeChatMessage[]
): RecipeChatMessage[] {
  const seenIds = new Set(messages.map((message) => message.id));

  return [...messages, ...additions.filter((message) => !seenIds.has(message.id))];
}

/**
 * Puts the stored history under what the conversation already shows: a question sent before the
 * history arrived stays after it, and a turn that is already shown is not repeated.
 */
export function mergeChatHistory(
  history: CookingChatMessage[],
  shown: RecipeChatMessage[]
): RecipeChatMessage[] {
  return appendUnseen(history.map(toRecipeChatMessage), shown);
}

/**
 * Whether the stored history holds the question sent with `clientMessageId` and the
 * conversation has not seen it: after a failed question it tells a lost answer (the server
 * stored both turns) from a question never stored.
 */
export function hasUnseenQuestion(
  history: CookingChatMessage[],
  seenTurnIds: ReadonlySet<string>,
  clientMessageId: string
): boolean {
  return history.some(
    (turn) =>
      turn.role === 'user' && turn.clientMessageId === clientMessageId && !seenTurnIds.has(turn.id)
  );
}

/** Swaps the pending question for the turns the server stored: the question, then its answer. */
export function reconcileChatTurns(
  messages: RecipeChatMessage[],
  pendingId: string,
  turns: CookingChatMessage[]
): RecipeChatMessage[] {
  return appendUnseen(
    messages.filter((message) => message.id !== pendingId),
    turns.map(toRecipeChatMessage)
  );
}
