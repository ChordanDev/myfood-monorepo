import { COOKING_ANSWER, COOKING_CHAT_HISTORY } from '@/features/cooking/fixtures';
import {
  createPendingUserMessage,
  hasUnseenQuestion,
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

describe('hasUnseenQuestion', () => {
  const history = [...COOKING_CHAT_HISTORY, ...COOKING_ANSWER.turns];
  const seen = new Set(COOKING_CHAT_HISTORY.map((turn) => turn.id));
  const [newQuestion, newAnswer] = COOKING_ANSWER.turns;
  const sent = { text: newQuestion.content, clientMessageId: newQuestion.clientMessageId! };
  // A history from an API that does not serve the id the app sent each question with.
  const withoutIds = history.map(({ clientMessageId: _id, ...turn }) => turn);

  it('finds the question the server stored under its client message id', () => {
    expect(hasUnseenQuestion(history, seen, sent)).toBe(true);
  });

  it('does not take a question with the same text but another id for it', () => {
    const otherId = { ...sent, clientMessageId: 'e9000000-0000-4000-8000-000000000009' };
    expect(hasUnseenQuestion(history, seen, otherId)).toBe(false);
  });

  it('does not take a question that was already seen for a new one', () => {
    const earlier = {
      text: STORED_QUESTION.content,
      clientMessageId: STORED_QUESTION.clientMessageId!,
    };
    expect(hasUnseenQuestion(history, seen, earlier)).toBe(false);
    expect(hasUnseenQuestion(COOKING_CHAT_HISTORY, seen, sent)).toBe(false);
  });

  it('only matches user turns', () => {
    const answerWithId = { ...newAnswer, clientMessageId: newQuestion.clientMessageId };
    expect(hasUnseenQuestion([answerWithId], seen, sent)).toBe(false);
  });

  it('finds the question by its text when the history carries no client message ids', () => {
    expect(hasUnseenQuestion(withoutIds, seen, sent)).toBe(true);
    expect(hasUnseenQuestion(withoutIds, seen, { ...sent, text: 'Otra pregunta' })).toBe(false);
    expect(hasUnseenQuestion(withoutIds.slice(0, 2), seen, sent)).toBe(false);
  });

  it('does not take a question stored without an id for one sent with an id', () => {
    const storedWithoutId = history.map((turn) =>
      turn.id === newQuestion.id ? { ...turn, clientMessageId: null } : turn
    );
    expect(hasUnseenQuestion(storedWithoutId, seen, sent)).toBe(false);
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
