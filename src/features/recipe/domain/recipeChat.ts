import type { UnitType } from '@/types/domain';
import type { RecipeIngredientRow } from './recipeIngredients';

export type RecipeChatAction = {
  id: 'confirm_add' | 'dismiss_add';
  label: string;
};

/** An ingredient the assistant offers to send to the shopping list. */
export type RecipeChatOffer = {
  name: string;
  ingredientId?: string;
  amount?: number;
  unit?: UnitType;
};

export type RecipeChatMessage = {
  id: string;
  author: 'assistant' | 'user';
  text: string;
  /** Quick replies shown under the message until one of them is chosen. */
  actions?: RecipeChatAction[];
  offer?: RecipeChatOffer;
};

export type RecipeChatReply = {
  text: string;
  offer?: RecipeChatOffer;
};

export const RECIPE_CHAT_PLACEHOLDER = 'Preguntale a la IA sobre la receta';
export const RECIPE_CHAT_DISABLED_PLACEHOLDER = 'El chat se habilita el día de la receta';

const OFFER_ACTIONS: RecipeChatAction[] = [
  { id: 'confirm_add', label: 'Sí, agregalo' },
  { id: 'dismiss_add', label: 'No hace falta' },
];

type BuildAssistantReplyArgs = {
  /** Not read by the mock; it is what the real assistant will answer to. */
  question: string;
  recipeName: string;
  rows: RecipeIngredientRow[];
};

function toOffer(row: RecipeIngredientRow): RecipeChatOffer {
  return {
    name: row.name,
    ingredientId: row.ingredientId,
    amount: row.missingAmount,
    ...(row.unit ? { unit: row.unit } : {}),
  };
}

/**
 * Deterministic stand-in for the assistant, written in Rioplatense `voseo`.
 *
 * When the inventory is short of an ingredient that was not requested yet, the reply closes by
 * offering to add the first one to the shopping list.
 */
export function buildAssistantReply({
  recipeName,
  rows,
}: BuildAssistantReplyArgs): RecipeChatReply {
  const advice = `Sí, podés adaptar ${recipeName} a tu gusto. Usá lo que ya tenés en casa y probá ajustar las cantidades de a poco.`;
  const missingRow = rows.find((row) => row.status === 'missing');
  if (!missingRow) return { text: advice };

  return {
    text: `${advice} No tenés ${missingRow.name.toLowerCase()} en el inventario, ¿lo agrego a compras?`,
    offer: toOffer(missingRow),
  };
}

export function createUserMessage(id: string, text: string): RecipeChatMessage {
  return { id, author: 'user', text };
}

export function createAssistantMessage(id: string, reply: RecipeChatReply): RecipeChatMessage {
  const message: RecipeChatMessage = { id, author: 'assistant', text: reply.text };
  if (!reply.offer) return message;

  return {
    ...message,
    offer: reply.offer,
    actions: OFFER_ACTIONS.map((action) => ({ ...action })),
  };
}

export type QuickActionResult = {
  messages: RecipeChatMessage[];
  /** The ingredient to send to the shopping list; `null` when there is nothing to add. */
  offerToAdd: RecipeChatOffer | null;
};

function buildOutcomeText(actionId: RecipeChatAction['id'], offer?: RecipeChatOffer): string {
  if (actionId === 'dismiss_add') return 'Dale, no lo agrego.';
  return `Listo, agregué ${(offer?.name ?? 'el ingrediente').toLowerCase()} a compras.`;
}

/**
 * Answers the quick actions of one assistant message: the chips go away, the chosen label is
 * appended as the user's turn and the assistant confirms the outcome.
 *
 * The appended ids derive from `messageId`, so a message can only be answered once; answering it
 * again, or a message without quick actions, leaves the conversation as it was.
 */
export function resolveQuickAction(
  messages: RecipeChatMessage[],
  messageId: string,
  actionId: RecipeChatAction['id']
): QuickActionResult {
  const answered = messages.find((message) => message.id === messageId);
  const chosen = answered?.actions?.find((action) => action.id === actionId);
  if (!answered || !chosen) return { messages, offerToAdd: null };

  const { actions: _answeredActions, ...withoutActions } = answered;
  const choiceId = `${messageId}-${actionId}`;

  return {
    messages: [
      ...messages.map((message) => (message.id === messageId ? withoutActions : message)),
      createUserMessage(choiceId, chosen.label),
      createAssistantMessage(`${choiceId}-reply`, {
        text: buildOutcomeText(actionId, answered.offer),
      }),
    ],
    offerToAdd: actionId === 'confirm_add' ? (answered.offer ?? null) : null,
  };
}
