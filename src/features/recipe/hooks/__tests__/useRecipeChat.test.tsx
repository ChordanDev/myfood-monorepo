import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { RecipeIngredientRow } from '../../domain/recipeIngredients';
import { RECIPE_CHAT_REPLY_DELAY_MS, useRecipeChat } from '../useRecipeChat';

type ChatArgs = Parameters<typeof useRecipeChat>[0];
type Chat = ReturnType<typeof useRecipeChat>;

const RICE_IN_STOCK: RecipeIngredientRow = {
  ingredientId: 'i1',
  name: 'Arroz blanco',
  quantityLabel: '100 g',
  requiredAmount: 100,
  availableAmount: 500,
  missingAmount: 0,
  unit: 'g',
  status: 'in_stock',
};
const CHICKEN_MISSING: RecipeIngredientRow = {
  ingredientId: 'i2',
  name: 'Pollo (pechuga)',
  quantityLabel: '200 g',
  requiredAmount: 200,
  availableAmount: 50,
  missingAmount: 150,
  unit: 'g',
  status: 'missing',
};
const CHICKEN_OFFER = { name: 'Pollo (pechuga)', ingredientId: 'i2', amount: 150, unit: 'g' };

function renderChat(overrides: Partial<ChatArgs> = {}) {
  const args: ChatArgs = {
    recipeName: 'Pollo con arroz y tomate',
    rows: [RICE_IN_STOCK],
    isEnabled: true,
    onAddOffer: jest.fn(),
    ...overrides,
  };
  const result = { current: null as unknown as Chat };

  function Harness(props: ChatArgs) {
    result.current = useRecipeChat(props);
    return null;
  }

  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<Harness {...args} />);
  });

  const rerender = (nextArgs: Partial<ChatArgs>) => {
    Object.assign(args, nextArgs);
    act(() => {
      tree.update(<Harness {...args} />);
    });
  };

  return { result, args, rerender, unmount: () => act(() => tree.unmount()) };
}

function ask(result: { current: Chat }, question: string) {
  act(() => {
    result.current.setInput(question);
  });
  act(() => {
    result.current.sendMessage();
  });
}

function waitForReply() {
  act(() => {
    jest.advanceTimersByTime(RECIPE_CHAT_REPLY_DELAY_MS);
  });
}

describe('useRecipeChat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts with an empty conversation', () => {
    const { result } = renderChat();

    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe('');
    expect(result.current.isThinking).toBe(false);
  });

  it('appends the question right away, clears the input and starts thinking', () => {
    const { result } = renderChat();

    ask(result, '  ¿Puedo hacerla más liviana?  ');

    expect(result.current.messages).toEqual([
      expect.objectContaining({ author: 'user', text: '¿Puedo hacerla más liviana?' }),
    ]);
    expect(result.current.input).toBe('');
    expect(result.current.isThinking).toBe(true);
  });

  it('appends the assistant reply after the delay and stops thinking', () => {
    const { result } = renderChat();

    ask(result, '¿Puedo hacerla más liviana?');
    act(() => {
      jest.advanceTimersByTime(RECIPE_CHAT_REPLY_DELAY_MS - 1);
    });

    expect(result.current.messages).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current.messages.map((message) => message.author)).toEqual(['user', 'assistant']);
    expect(result.current.messages[1].text).toContain('Pollo con arroz y tomate');
    expect(result.current.isThinking).toBe(false);
  });

  it('gives every message its own id across turns', () => {
    const { result } = renderChat();

    ask(result, 'Primera');
    waitForReply();
    ask(result, 'Segunda');
    waitForReply();

    const ids = result.current.messages.map((message) => message.id);

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('ignores an empty question', () => {
    const { result } = renderChat();

    ask(result, '   ');

    expect(result.current.messages).toEqual([]);
    expect(result.current.isThinking).toBe(false);
  });

  it('does not send a second question while the assistant is thinking', () => {
    const { result } = renderChat();

    ask(result, 'Primera');
    ask(result, 'Segunda');

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.input).toBe('Segunda');
  });

  it('does not send anything while the chat is disabled', () => {
    const { result } = renderChat({ isEnabled: false });

    ask(result, '¿Puedo hacerla más liviana?');
    waitForReply();

    expect(result.current.messages).toEqual([]);
    expect(result.current.isThinking).toBe(false);
  });

  it('drops the pending reply when the screen leaves', () => {
    const { result, unmount } = renderChat();

    ask(result, '¿Puedo hacerla más liviana?');
    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
  describe('offer to add a missing ingredient', () => {
    function askWithMissingChicken(overrides: Partial<ChatArgs> = {}) {
      const chat = renderChat({ rows: [RICE_IN_STOCK, CHICKEN_MISSING], ...overrides });

      ask(chat.result, '¿Puedo hacerla más liviana?');
      waitForReply();

      return { ...chat, offerMessage: chat.result.current.messages[1] };
    }

    it('offers the ingredient the inventory is short of, with both quick actions', () => {
      const { offerMessage } = askWithMissingChicken();

      expect(offerMessage.offer).toEqual(CHICKEN_OFFER);
      expect(offerMessage.actions?.map((action) => action.label)).toEqual([
        'Sí, agregalo',
        'No hace falta',
      ]);
    });

    it('offers what is missing when the reply arrives, not when the question was sent', () => {
      const { result, rerender } = renderChat({ rows: [RICE_IN_STOCK] });

      ask(result, '¿Puedo hacerla más liviana?');
      rerender({ rows: [RICE_IN_STOCK, CHICKEN_MISSING] });
      waitForReply();

      expect(result.current.messages[1].offer).toEqual(CHICKEN_OFFER);
    });

    it('adds the ingredient and removes the quick actions when the user confirms', () => {
      const { result, args, offerMessage } = askWithMissingChicken();

      act(() => {
        result.current.answerQuickAction(offerMessage.id, 'confirm_add');
      });

      expect(args.onAddOffer).toHaveBeenCalledTimes(1);
      expect(args.onAddOffer).toHaveBeenCalledWith(CHICKEN_OFFER);
      expect(result.current.messages.every((message) => message.actions === undefined)).toBe(true);
      expect(result.current.messages.slice(2)).toEqual([
        expect.objectContaining({ author: 'user', text: 'Sí, agregalo' }),
        expect.objectContaining({ author: 'assistant' }),
      ]);
    });

    it('adds nothing and removes the quick actions when the user dismisses the offer', () => {
      const { result, args, offerMessage } = askWithMissingChicken();

      act(() => {
        result.current.answerQuickAction(offerMessage.id, 'dismiss_add');
      });

      expect(args.onAddOffer).not.toHaveBeenCalled();
      expect(result.current.messages.every((message) => message.actions === undefined)).toBe(true);
      expect(result.current.messages[2]).toEqual(
        expect.objectContaining({ author: 'user', text: 'No hace falta' })
      );
    });

    it('adds the ingredient only once when the same offer is answered twice', () => {
      const { result, args, offerMessage } = askWithMissingChicken();

      act(() => {
        result.current.answerQuickAction(offerMessage.id, 'confirm_add');
      });
      act(() => {
        result.current.answerQuickAction(offerMessage.id, 'confirm_add');
      });

      expect(args.onAddOffer).toHaveBeenCalledTimes(1);
      expect(result.current.messages).toHaveLength(4);
    });
  });
});
