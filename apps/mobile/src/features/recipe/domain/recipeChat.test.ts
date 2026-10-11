import { COOKING_ANSWER, COOKING_CHAT_HISTORY } from '@/features/cooking/fixtures';
import {
  createPendingUserMessage,
  mergeChatHistory,
  recipeChatPlaceholder,
  reconcileChatTurns,
  toRecipeChatMessage,
} from './recipeChat';

const [STORED_QUESTION, STORED_ANSWER] = COOKING_CHAT_HISTORY;

describe('toRecipeChatMessage', () => {
  it('keeps the server id and reads the role as the author', () => {
    expect(toRecipeChatMessage(STORED_QUESTION)).toEqual({
      id: STORED_QUESTION.id,
      author: 'user',
      text: '¿Puedo usar menos aceite?',
    });
    expect(toRecipeChatMessage(STORED_ANSWER).author).toBe('assistant');
  });
});

describe('createPendingUserMessage', () => {
  it('builds a message written by the user', () => {
    expect(createPendingUserMessage('pending-1', '¿Cuánto tarda el arroz?')).toEqual({
      id: 'pending-1',
      author: 'user',
      text: '¿Cuánto tarda el arroz?',
    });
  });
});

describe('mergeChatHistory', () => {
  it('puts the stored history first and keeps a question still on its way', () => {
    const pending = createPendingUserMessage('pending-1', '¿Cuánto tarda el arroz?');

    const merged = mergeChatHistory(COOKING_CHAT_HISTORY, [pending]);

    expect(merged.map((message) => message.id)).toEqual([
      STORED_QUESTION.id,
      STORED_ANSWER.id,
      'pending-1',
    ]);
  });

  it('does not repeat a turn the conversation already shows', () => {
    const shown = COOKING_CHAT_HISTORY.map(toRecipeChatMessage);

    expect(mergeChatHistory(COOKING_CHAT_HISTORY, shown)).toEqual(shown);
  });
});

describe('reconcileChatTurns', () => {
  const pending = createPendingUserMessage('pending-1', '¿Cuánto tarda el arroz?');

  it('replaces the pending question with the two stored turns, in order', () => {
    const history = COOKING_CHAT_HISTORY.map(toRecipeChatMessage);

    const messages = reconcileChatTurns([...history, pending], 'pending-1', COOKING_ANSWER.turns);

    expect(messages.map((message) => message.id)).toEqual([
      STORED_QUESTION.id,
      STORED_ANSWER.id,
      COOKING_ANSWER.turns[0].id,
      COOKING_ANSWER.turns[1].id,
    ]);
    expect(messages.map((message) => message.author)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('does not repeat a turn that is already in the conversation', () => {
    const alreadyThere = COOKING_ANSWER.turns.map(toRecipeChatMessage);

    const messages = reconcileChatTurns(
      [...alreadyThere, pending],
      'pending-1',
      COOKING_ANSWER.turns
    );

    expect(messages).toEqual(alreadyThere);
  });
});

describe('recipeChatPlaceholder', () => {
  it('invites the user to ask about the recipe', () => {
    expect(recipeChatPlaceholder('available')).toBe('Preguntale a la IA sobre la receta');
  });

  it('explains when the chat becomes available', () => {
    expect(recipeChatPlaceholder('unavailable')).toBe('Chat disponible el día de la receta');
  });

  it('says the chat is over once the meal was cooked', () => {
    expect(recipeChatPlaceholder('finished')).toBe('Chat cerrado: la comida ya está cocinada');
  });
});
