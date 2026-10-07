import {
  RECIPE_CHAT_DISABLED_PLACEHOLDER,
  RECIPE_CHAT_PLACEHOLDER,
  buildAssistantReply,
  createAssistantMessage,
  createUserMessage,
  resolveQuickAction,
} from './recipeChat';
import type { RecipeIngredientRow } from './recipeIngredients';

const RECIPE_NAME = 'Pollo con Arroz y Tomate';

/** Second person forms of the `tuteo`; the assistant speaks in Rioplatense `voseo`. */
const TUTEO_WORDS = ['puedes', 'tienes', 'usa', 'prueba', 'quieres', 'agrega'];

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

function expectVoseo(text: string) {
  const words = wordsOf(text);
  TUTEO_WORDS.forEach((word) => expect(words).not.toContain(word));
}

function buildRow(overrides: Partial<RecipeIngredientRow> = {}): RecipeIngredientRow {
  return {
    ingredientId: 'i1',
    name: 'Arroz blanco',
    quantityLabel: '100 g',
    requiredAmount: 100,
    availableAmount: 500,
    missingAmount: 0,
    unit: 'gramos',
    status: 'in_stock',
    ...overrides,
  };
}

const RICE_IN_STOCK = buildRow();
const CHICKEN_MISSING = buildRow({
  ingredientId: 'i2',
  name: 'Pollo (pechuga)',
  quantityLabel: '200 g',
  requiredAmount: 200,
  availableAmount: 50,
  missingAmount: 150,
  status: 'missing',
});
const TOMATO_MISSING = buildRow({
  ingredientId: 'i3',
  name: 'Tomate',
  quantityLabel: '2 u',
  requiredAmount: 2,
  availableAmount: 0,
  missingAmount: 2,
  unit: 'unidades',
  status: 'missing',
});
const TOMATO_REQUESTED: RecipeIngredientRow = { ...TOMATO_MISSING, status: 'requested' };
/** A recipe line whose id is not in the catalog: it has no unit and always counts as missing. */
const UNKNOWN_MISSING = buildRow({
  ingredientId: 'ghost',
  name: 'Ingrediente desconocido',
  quantityLabel: '3',
  requiredAmount: 3,
  availableAmount: 0,
  missingAmount: 3,
  unit: null,
  status: 'missing',
});

function reply(rows: RecipeIngredientRow[], question = '¿Puedo hacerla más liviana?') {
  return buildAssistantReply({ question, recipeName: RECIPE_NAME, rows });
}

describe('buildAssistantReply', () => {
  it('answers about the recipe', () => {
    const { text } = reply([RICE_IN_STOCK]);

    expect(text).toContain(RECIPE_NAME);
    expect(text.length).toBeGreaterThan(RECIPE_NAME.length);
  });

  it('gives the same answer for the same input', () => {
    expect(reply([RICE_IN_STOCK, CHICKEN_MISSING])).toEqual(
      reply([RICE_IN_STOCK, CHICKEN_MISSING])
    );
  });

  it('speaks in voseo', () => {
    const answers = [reply([RICE_IN_STOCK]), reply([RICE_IN_STOCK, CHICKEN_MISSING])];

    answers.forEach(({ text }) => {
      expectVoseo(text);
      expect(wordsOf(text)).toEqual(expect.arrayContaining(['podés']));
    });
  });

  it('makes no offer when nothing is missing', () => {
    const answer = reply([RICE_IN_STOCK]);

    expect(answer.offer).toBeUndefined();
    expect(answer.text).not.toContain('¿lo agrego a compras?');
  });

  it('makes no offer for an empty ingredient list', () => {
    expect(reply([]).offer).toBeUndefined();
  });

  it('ends by offering to add the first missing ingredient to the shopping list', () => {
    const answer = reply([RICE_IN_STOCK, CHICKEN_MISSING, TOMATO_MISSING]);

    expect(
      answer.text.endsWith('No tenés pollo (pechuga) en el inventario, ¿lo agrego a compras?')
    ).toBe(true);
    expect(answer.offer).toEqual({
      name: 'Pollo (pechuga)',
      ingredientId: 'i2',
      amount: 150,
      unit: 'gramos',
    });
  });

  it('does not offer an ingredient that was already requested', () => {
    const answer = reply([RICE_IN_STOCK, TOMATO_REQUESTED]);

    expect(answer.offer).toBeUndefined();
  });

  it('skips requested ingredients and offers the first one still missing', () => {
    const answer = reply([TOMATO_REQUESTED, CHICKEN_MISSING]);

    expect(answer.offer?.ingredientId).toBe('i2');
  });

  it('never offers an ingredient that is not in the catalog', () => {
    const answer = reply([UNKNOWN_MISSING]);

    expect(answer.offer).toBeUndefined();
    expect(answer.text).not.toContain('compras');
  });

  it('skips an unknown ingredient and offers the first known one still missing', () => {
    const answer = reply([UNKNOWN_MISSING, CHICKEN_MISSING]);

    expect(answer.offer).toEqual({
      name: 'Pollo (pechuga)',
      ingredientId: 'i2',
      amount: 150,
      unit: 'gramos',
    });
    expect(answer.text).toContain('pollo (pechuga)');
  });
});

describe('createUserMessage', () => {
  it('builds a message written by the user', () => {
    expect(createUserMessage('m1', '¿Puedo hacerla más liviana?')).toEqual({
      id: 'm1',
      author: 'user',
      text: '¿Puedo hacerla más liviana?',
    });
  });
});

describe('createAssistantMessage', () => {
  it('builds a plain assistant message when the reply has no offer', () => {
    expect(createAssistantMessage('m2', reply([RICE_IN_STOCK]))).toEqual({
      id: 'm2',
      author: 'assistant',
      text: reply([RICE_IN_STOCK]).text,
    });
  });

  it('carries the offer and both quick actions when the reply has an offer', () => {
    const answer = reply([CHICKEN_MISSING]);

    expect(createAssistantMessage('m2', answer)).toEqual({
      id: 'm2',
      author: 'assistant',
      text: answer.text,
      offer: answer.offer,
      actions: [
        { id: 'confirm_add', label: 'Sí, agregalo' },
        { id: 'dismiss_add', label: 'No hace falta' },
      ],
    });
  });
});

describe('resolveQuickAction', () => {
  const question = createUserMessage('m1', '¿Puedo hacerla más liviana?');
  const offerMessage = createAssistantMessage('m2', reply([CHICKEN_MISSING]));
  const conversation = [question, offerMessage];

  it('returns the offer to add when the user confirms', () => {
    const { offerToAdd } = resolveQuickAction(conversation, 'm2', 'confirm_add');

    expect(offerToAdd).toEqual({
      name: 'Pollo (pechuga)',
      ingredientId: 'i2',
      amount: 150,
      unit: 'gramos',
    });
  });

  it('returns no offer when the user dismisses it', () => {
    const { offerToAdd } = resolveQuickAction(conversation, 'm2', 'dismiss_add');

    expect(offerToAdd).toBeNull();
  });

  it('removes the quick actions from the answered message', () => {
    const { messages } = resolveQuickAction(conversation, 'm2', 'confirm_add');

    expect(messages[1].id).toBe('m2');
    expect(messages[1].actions).toBeUndefined();
    expect(messages[1].text).toBe(offerMessage.text);
  });

  it('appends the chosen label and a confirmation after confirming', () => {
    const { messages } = resolveQuickAction(conversation, 'm2', 'confirm_add');

    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ id: 'm2-confirm_add', author: 'user', text: 'Sí, agregalo' });
    expect(messages[3]).toEqual({
      id: 'm2-confirm_add-reply',
      author: 'assistant',
      text: 'Listo, agregué pollo (pechuga) a compras.',
    });
  });

  it('appends the chosen label and an acknowledgement after dismissing', () => {
    const { messages } = resolveQuickAction(conversation, 'm2', 'dismiss_add');

    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ id: 'm2-dismiss_add', author: 'user', text: 'No hace falta' });
    expect(messages[3]).toEqual({
      id: 'm2-dismiss_add-reply',
      author: 'assistant',
      text: 'Dale, no lo agrego.',
    });
  });

  it('answers in voseo', () => {
    const confirmed = resolveQuickAction(conversation, 'm2', 'confirm_add').messages;
    const dismissed = resolveQuickAction(conversation, 'm2', 'dismiss_add').messages;

    [...confirmed, ...dismissed]
      .filter((message) => message.author === 'assistant')
      .forEach((message) => expectVoseo(message.text));
  });

  it('appends at the end of the conversation, after later messages', () => {
    const later = createUserMessage('m3', '¿Y cuánto tarda?');

    const { messages } = resolveQuickAction([...conversation, later], 'm2', 'confirm_add');

    expect(messages.map((message) => message.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm2-confirm_add',
      'm2-confirm_add-reply',
    ]);
  });

  it('does not mutate the conversation it receives', () => {
    resolveQuickAction(conversation, 'm2', 'confirm_add');

    expect(conversation).toHaveLength(2);
    expect(conversation[1].actions).toHaveLength(2);
  });

  it('does nothing the second time the same message is answered', () => {
    const first = resolveQuickAction(conversation, 'm2', 'confirm_add');

    const second = resolveQuickAction(first.messages, 'm2', 'confirm_add');

    expect(second.messages).toEqual(first.messages);
    expect(second.offerToAdd).toBeNull();
  });

  it('does nothing for a message that is not in the conversation', () => {
    const result = resolveQuickAction(conversation, 'nope', 'confirm_add');

    expect(result).toEqual({ messages: conversation, offerToAdd: null });
  });

  it('does nothing for a message without quick actions', () => {
    const result = resolveQuickAction(conversation, 'm1', 'confirm_add');

    expect(result).toEqual({ messages: conversation, offerToAdd: null });
  });
});

describe('chat composer copy', () => {
  it('invites the user to ask about the recipe', () => {
    expect(RECIPE_CHAT_PLACEHOLDER).toBe('Preguntale a la IA sobre la receta');
  });

  it('explains when the chat becomes available', () => {
    expect(RECIPE_CHAT_DISABLED_PLACEHOLDER).toBe('Chat disponible el día de la receta');
  });
});
