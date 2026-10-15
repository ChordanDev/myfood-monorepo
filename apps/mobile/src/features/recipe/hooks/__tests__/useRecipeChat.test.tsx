import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AUTH_ERROR_MESSAGES, ApiError } from '@/api/errors';
import { askCookingSession, getCookingSession, startCookingSession } from '@/features/cooking/api';
import {
  COOKING_ANSWER,
  COOKING_CHAT_HISTORY,
  COOKING_QUESTION,
  COOKING_SCHEDULED_MEAL_ID,
  COOKING_SESSION_FINISHED,
  COOKING_SESSION_ID,
  COOKING_SESSION_WITH_HISTORY,
  COOKING_START,
} from '@/features/cooking/fixtures';
import { useRecipeChat } from '../useRecipeChat';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/features/cooking/api', () => ({
  startCookingSession: jest.fn(),
  getCookingSession: jest.fn(),
  askCookingSession: jest.fn(),
  finishCookingSession: jest.fn(),
}));

const startMock = jest.mocked(startCookingSession);
const readMock = jest.mocked(getCookingSession);
const askMock = jest.mocked(askCookingSession);

type ChatArgs = Parameters<typeof useRecipeChat>[0];
type Chat = ReturnType<typeof useRecipeChat>;

const OTHER_MEAL_ID = 'b7a1d3c2-0000-4000-8000-00000000000b';
const HISTORY_IDS = COOKING_CHAT_HISTORY.map((turn) => turn.id);
const ANSWER_IDS = COOKING_ANSWER.turns.map((turn) => turn.id);
const OTHER_SESSION_ID = 'd2000000-0000-4000-8000-00000000000b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The session read once the question that lost its answer was stored after all.
const SESSION_WITH_ANSWER = {
  ...COOKING_SESSION_WITH_HISTORY,
  chatMessages: [...COOKING_CHAT_HISTORY, ...COOKING_ANSWER.turns],
};
const sentMessageIds = () => askMock.mock.calls.map(([, , clientMessageId]) => clientMessageId);
// The same read, with the question stored under the id the app sent.
const sessionWithSentAnswer = () => {
  const [question, answer] = COOKING_ANSWER.turns;

  return {
    ...COOKING_SESSION_WITH_HISTORY,
    chatMessages: [
      ...COOKING_CHAT_HISTORY,
      { ...question, clientMessageId: sentMessageIds()[0] },
      answer,
    ],
  };
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function renderChat(overrides: Partial<ChatArgs> = {}) {
  const args: ChatArgs = {
    scheduledMealId: COOKING_SCHEDULED_MEAL_ID,
    isEnabled: true,
    isCooked: false,
    ...overrides,
  };
  const result = { current: null as unknown as Chat };

  function Harness(props: ChatArgs) {
    result.current = useRecipeChat(props);
    return null;
  }

  let tree: ReactTestRenderer;
  // The session opens on mount; the act lets its answers land.
  await act(async () => {
    tree = create(<Harness {...args} />);
  });

  const rerender = async (nextArgs: Partial<ChatArgs>) => {
    Object.assign(args, nextArgs);
    await act(async () => {
      tree.update(<Harness {...args} />);
    });
  };

  return { result, rerender, unmount: () => act(() => tree.unmount()) };
}

async function ask(result: { current: Chat }, question: string) {
  act(() => {
    result.current.setInput(question);
  });
  await act(async () => {
    result.current.sendMessage();
  });
}

const ids = (result: { current: Chat }) => result.current.messages.map((message) => message.id);

describe('useRecipeChat', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    startMock.mockResolvedValue(COOKING_START);
    readMock.mockResolvedValue(COOKING_SESSION_WITH_HISTORY);
    askMock.mockResolvedValue(COOKING_ANSWER);
  });

  describe('opening the chat', () => {
    it('opens the session of the meal and recovers its history from the session read', async () => {
      const { result } = await renderChat();

      expect(startMock).toHaveBeenCalledWith(COOKING_SCHEDULED_MEAL_ID);
      expect(readMock).toHaveBeenCalledWith(COOKING_SESSION_ID);
      expect(result.current.messages).toEqual([
        { id: HISTORY_IDS[0], author: 'user', text: '¿Puedo usar menos aceite?' },
        { id: HISTORY_IDS[1], author: 'assistant', text: 'Sí, con la mitad alcanza.' },
      ]);
      expect(result.current.availability).toBe('available');
      expect(result.current.errorMessage).toBeNull();
    });

    it.each<Partial<ChatArgs>>([
      { isEnabled: false },
      { scheduledMealId: null },
      { isEnabled: false, scheduledMealId: null },
    ])('makes no request while the chat is disabled: %j', async (overrides) => {
      const { result } = await renderChat(overrides);

      await ask(result, COOKING_QUESTION);

      expect(startMock).not.toHaveBeenCalled();
      expect(readMock).not.toHaveBeenCalled();
      expect(askMock).not.toHaveBeenCalled();
      expect(result.current.messages).toEqual([]);
      expect(result.current.availability).toBe('unavailable');
    });

    it('opens the finished session of a cooked meal and shows its history, closed', async () => {
      startMock.mockResolvedValue(COOKING_SESSION_FINISHED);
      readMock.mockResolvedValue(COOKING_SESSION_FINISHED);

      const { result } = await renderChat({ isCooked: true });
      await ask(result, COOKING_QUESTION);

      expect(startMock).toHaveBeenCalledWith(COOKING_SCHEDULED_MEAL_ID);
      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(result.current.availability).toBe('finished');
      expect(result.current.errorMessage).toBeNull();
      expect(askMock).not.toHaveBeenCalled();
    });

    it('closes the chat when the session the server returns already finished', async () => {
      startMock.mockResolvedValue(COOKING_SESSION_FINISHED);
      readMock.mockResolvedValue(COOKING_SESSION_FINISHED);

      const { result } = await renderChat({ isCooked: false });
      await ask(result, COOKING_QUESTION);

      expect(result.current.availability).toBe('finished');
      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(askMock).not.toHaveBeenCalled();
    });

    it('closes the chat when the server says the meal is not on its today', async () => {
      startMock.mockRejectedValue(new ApiError('cooking_chat_unavailable', 'no', 409));

      const { result } = await renderChat();

      expect(result.current.availability).toBe('unavailable');
      expect(readMock).not.toHaveBeenCalled();
    });

    it('says why the history could not be loaded', async () => {
      readMock.mockRejectedValue(new ApiError('network_error', 'offline'));

      const { result } = await renderChat();

      expect(result.current.messages).toEqual([]);
      expect(result.current.availability).toBe('available');
      expect(result.current.errorMessage).toEqual(expect.any(String));
    });

    it('opens the session again on the next question after a failed open', async () => {
      startMock.mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(startMock).toHaveBeenCalledTimes(2);
      expect(askMock).toHaveBeenCalledWith(
        COOKING_SESSION_ID,
        COOKING_QUESTION,
        expect.stringMatching(UUID)
      );
      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
      expect(result.current.errorMessage).toBeNull();
    });
  });

  describe('asking', () => {
    it('shows the question right away, clears the input and starts thinking', async () => {
      const pendingAnswer = deferred<typeof COOKING_ANSWER>();
      askMock.mockReturnValue(pendingAnswer.promise);
      const { result } = await renderChat();

      await ask(result, `  ${COOKING_QUESTION}  `);

      expect(askMock).toHaveBeenCalledWith(
        COOKING_SESSION_ID,
        COOKING_QUESTION,
        expect.stringMatching(UUID)
      );
      expect(result.current.messages).toHaveLength(3);
      expect(result.current.messages[2]).toEqual(
        expect.objectContaining({ author: 'user', text: COOKING_QUESTION })
      );
      expect(result.current.input).toBe('');
      expect(result.current.isThinking).toBe(true);

      await act(async () => pendingAnswer.resolve(COOKING_ANSWER));
    });

    it('appends both stored turns in order, without repeating the optimistic question', async () => {
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
      expect(result.current.messages.slice(2)).toEqual([
        { id: ANSWER_IDS[0], author: 'user', text: COOKING_QUESTION },
        { id: ANSWER_IDS[1], author: 'assistant', text: 'Unos 18 minutos a fuego bajo.' },
      ]);
      expect(result.current.isThinking).toBe(false);
    });

    it('keeps a question sent before the history arrived, after the history', async () => {
      const pendingRead = deferred<typeof COOKING_SESSION_WITH_HISTORY>();
      readMock.mockReturnValue(pendingRead.promise);
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);
      expect(result.current.messages).toHaveLength(1);
      expect(askMock).not.toHaveBeenCalled();

      await act(async () => pendingRead.resolve(COOKING_SESSION_WITH_HISTORY));

      expect(startMock).toHaveBeenCalledTimes(1);
      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
    });

    it('ignores an empty question', async () => {
      const { result } = await renderChat();

      await ask(result, '   ');

      expect(askMock).not.toHaveBeenCalled();
      expect(result.current.messages).toHaveLength(2);
    });

    it('does not send a second question while the assistant is thinking', async () => {
      const pendingAnswer = deferred<typeof COOKING_ANSWER>();
      askMock.mockReturnValue(pendingAnswer.promise);
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);
      await ask(result, 'Segunda');

      expect(askMock).toHaveBeenCalledTimes(1);
      expect(result.current.messages).toHaveLength(3);
      expect(result.current.input).toBe('Segunda');

      await act(async () => pendingAnswer.resolve(COOKING_ANSWER));
    });

    it('sends once when the submit lands twice before the screen re-renders', async () => {
      const { result } = await renderChat();
      act(() => {
        result.current.setInput(COOKING_QUESTION);
      });

      const { sendMessage } = result.current;
      await act(async () => {
        sendMessage();
        sendMessage();
      });

      expect(askMock).toHaveBeenCalledTimes(1);
      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
    });
  });

  describe('when a question fails', () => {
    it('takes the question back, restores the input and says why', async () => {
      askMock.mockRejectedValue(new ApiError('validation_error', 'too long', 422));
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(result.current.input).toBe(COOKING_QUESTION);
      expect(result.current.isThinking).toBe(false);
      expect(result.current.errorMessage).toEqual(expect.any(String));
      expect(result.current.availability).toBe('available');
    });

    it('re-reads the session and shows the stored turns when only the answer was lost', async () => {
      askMock.mockRejectedValue(new ApiError('network_error', 'offline'));
      readMock
        .mockResolvedValueOnce(COOKING_SESSION_WITH_HISTORY)
        .mockImplementationOnce(async () => sessionWithSentAnswer());
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(readMock).toHaveBeenCalledTimes(2);
      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
      expect(result.current.input).toBe('');
      expect(result.current.isThinking).toBe(false);
      expect(result.current.errorMessage).toBeNull();
    });

    it('does not take an unseen question with the same text but another id', async () => {
      askMock.mockRejectedValue(new ApiError('network_error', 'offline'));
      readMock
        .mockResolvedValueOnce(COOKING_SESSION_WITH_HISTORY)
        .mockResolvedValueOnce(SESSION_WITH_ANSWER);
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(readMock).toHaveBeenCalledTimes(2);
      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(result.current.input).toBe(COOKING_QUESTION);
      expect(result.current.errorMessage).toEqual(expect.any(String));
    });

    it('says the daily limit was reached and keeps the question, without reading again', async () => {
      askMock.mockRejectedValue(new ApiError('cooking_chat_limit_reached', 'limit', 429));
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(result.current.errorMessage).toBe(AUTH_ERROR_MESSAGES.cooking_chat_limit_reached);
      expect(result.current.availability).toBe('available');
      expect(result.current.input).toBe(COOKING_QUESTION);
      expect(ids(result)).toEqual(HISTORY_IDS);
      // The limit is checked before anything is stored.
      expect(readMock).toHaveBeenCalledTimes(1);
    });

    it('does not take an earlier, identical question for the one that failed', async () => {
      const [earlierQuestion, earlierAnswer] = COOKING_CHAT_HISTORY;
      askMock.mockRejectedValue(new ApiError('network_error', 'offline'));
      const { result } = await renderChat();

      await ask(result, earlierQuestion.content);

      expect(ids(result)).toEqual([earlierQuestion.id, earlierAnswer.id]);
      expect(result.current.input).toBe(earlierQuestion.content);
      expect(result.current.errorMessage).toEqual(expect.any(String));
    });

    it('restores the input when the session cannot be read again either', async () => {
      askMock.mockRejectedValue(new ApiError('network_error', 'offline'));
      readMock
        .mockResolvedValueOnce(COOKING_SESSION_WITH_HISTORY)
        .mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(result.current.input).toBe(COOKING_QUESTION);
      expect(result.current.errorMessage).toEqual(expect.any(String));
    });

    it('resends the unchanged text with the same message id', async () => {
      askMock.mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const { result } = await renderChat();
      await ask(result, COOKING_QUESTION);

      await act(async () => {
        result.current.sendMessage();
      });

      const [first, second] = sentMessageIds();
      expect(first).toMatch(UUID);
      expect(second).toBe(first);
      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
    });

    it('sends an edited question, and every new question, with a new message id', async () => {
      askMock.mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const { result } = await renderChat();
      await ask(result, COOKING_QUESTION);

      await ask(result, `${COOKING_QUESTION} ¿Y la sal?`);
      await ask(result, COOKING_QUESTION);

      expect(new Set(sentMessageIds()).size).toBe(3);
    });

    it('clears the error on the next question', async () => {
      askMock.mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const { result } = await renderChat();
      await ask(result, COOKING_QUESTION);

      await ask(result, COOKING_QUESTION);

      expect(result.current.errorMessage).toBeNull();
      expect(ids(result)).toEqual([...HISTORY_IDS, ...ANSWER_IDS]);
    });

    it.each([
      ['cooking_chat_unavailable', 'unavailable'],
      ['cooking_already_finished', 'finished'],
    ] as const)('closes the chat on %s and keeps the history', async (code, availability) => {
      askMock.mockRejectedValue(new ApiError(code, 'no', 409));
      const { result } = await renderChat();

      await ask(result, COOKING_QUESTION);

      expect(result.current.availability).toBe(availability);
      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(result.current.isThinking).toBe(false);
      // A refusal says the question was not stored: the session is not read again.
      expect(readMock).toHaveBeenCalledTimes(1);

      await ask(result, 'Otra');
      expect(askMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the meal is cooked', () => {
    it('closes the chat and keeps the conversation on screen', async () => {
      const { result, rerender } = await renderChat();

      await rerender({ isCooked: true });
      await ask(result, COOKING_QUESTION);

      expect(result.current.availability).toBe('finished');
      expect(ids(result)).toEqual(HISTORY_IDS);
      expect(askMock).not.toHaveBeenCalled();
      expect(startMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('late answers', () => {
    it('drops an answer that lands after the screen left', async () => {
      const pendingAnswer = deferred<typeof COOKING_ANSWER>();
      askMock.mockReturnValue(pendingAnswer.promise);
      const { result, unmount } = await renderChat();
      await ask(result, COOKING_QUESTION);
      const before = result.current;

      unmount();
      await act(async () => pendingAnswer.resolve(COOKING_ANSWER));

      expect(result.current).toBe(before);
    });

    it('drops the answer of another meal and shows the history of the current one', async () => {
      const pendingAnswer = deferred<typeof COOKING_ANSWER>();
      askMock.mockReturnValue(pendingAnswer.promise);
      const { result, rerender } = await renderChat();
      await ask(result, COOKING_QUESTION);

      readMock.mockResolvedValue({ ...COOKING_START, scheduledMealId: OTHER_MEAL_ID });
      await rerender({ scheduledMealId: OTHER_MEAL_ID });

      expect(startMock).toHaveBeenLastCalledWith(OTHER_MEAL_ID);
      expect(result.current.messages).toEqual([]);
      expect(result.current.isThinking).toBe(false);

      await act(async () => pendingAnswer.resolve(COOKING_ANSWER));

      expect(result.current.messages).toEqual([]);
    });

    it('asks on another meal while the answer of the previous one is still pending', async () => {
      const pendingAnswer = deferred<typeof COOKING_ANSWER>();
      askMock.mockReturnValueOnce(pendingAnswer.promise);
      const { result, rerender } = await renderChat();
      await ask(result, COOKING_QUESTION);

      const otherSession = {
        ...COOKING_START,
        sessionId: OTHER_SESSION_ID,
        scheduledMealId: OTHER_MEAL_ID,
      };
      startMock.mockResolvedValue(otherSession);
      readMock.mockResolvedValue(otherSession);
      await rerender({ scheduledMealId: OTHER_MEAL_ID });

      await ask(result, 'Otra comida');

      expect(askMock).toHaveBeenCalledTimes(2);
      expect(askMock).toHaveBeenLastCalledWith(
        OTHER_SESSION_ID,
        'Otra comida',
        expect.stringMatching(UUID)
      );
      expect(ids(result)).toEqual(ANSWER_IDS);

      // The late answer of the first meal neither lands here nor frees a guard it does not own.
      await act(async () => pendingAnswer.resolve(COOKING_ANSWER));
      expect(ids(result)).toEqual(ANSWER_IDS);
    });
  });
});
