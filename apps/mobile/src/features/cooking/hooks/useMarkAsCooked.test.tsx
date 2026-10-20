import { act, create } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { useMealPlanStore } from '@/store';
import type { MealPlanEntry } from '@/types/domain';
import { confirmPastMeal, finishCookingSession, startCookingSession } from '../api';
import {
  COOKING_FINISH_WITH_SHORTAGE,
  COOKING_SCHEDULED_MEAL_ID,
  COOKING_SESSION_ID,
  COOKING_START,
} from '../fixtures';
import { useMarkAsCooked } from './useMarkAsCooked';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../api', () => ({
  startCookingSession: jest.fn(),
  finishCookingSession: jest.fn(),
  confirmPastMeal: jest.fn(),
}));

const startMock = jest.mocked(startCookingSession);
const finishMock = jest.mocked(finishCookingSession);
const confirmMock = jest.mocked(confirmPastMeal);

const ENTRY: MealPlanEntry = {
  id: COOKING_SCHEDULED_MEAL_ID,
  date: '2026-10-08',
  type: 'lunch',
  recipeId: 'r1',
  isCooked: false,
};

let hook: ReturnType<typeof useMarkAsCooked>;
let tree: ReturnType<typeof create> | null = null;

function Harness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result.
  hook = useMarkAsCooked();
  return null;
}

describe('useMarkAsCooked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMealPlanStore.setState({ entries: [ENTRY] });
    act(() => {
      tree = create(<Harness />);
    });
  });

  afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
  });

  it('starts the session, finishes it and shows the summary', async () => {
    startMock.mockResolvedValue(COOKING_START);
    finishMock.mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);

    let result: boolean | undefined;
    await act(async () => {
      result = await hook.markAsCooked(ENTRY.id);
    });

    expect(startMock).toHaveBeenCalledWith(ENTRY.id);
    expect(finishMock).toHaveBeenCalledWith(COOKING_SESSION_ID);
    expect(result).toBe(true);
    expect(hook.summary?.recipeName).toBe('Arroz con aceite');
    expect(hook.summary?.shortages).toHaveLength(1);
    expect(hook.errorMessage).toBeNull();
    expect(hook.isPending).toBe(false);
  });

  it('marks the local entry cooked only after the finish succeeded', async () => {
    startMock.mockResolvedValue(COOKING_START);
    finishMock.mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);

    await act(async () => {
      await hook.markAsCooked(ENTRY.id);
    });

    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
  });

  it('does not finish nor mark the entry when the start is refused, and says why', async () => {
    startMock.mockRejectedValue(new ApiError('cooking_chat_unavailable', 'no', 422));

    let result: boolean | undefined;
    await act(async () => {
      result = await hook.markAsCooked(ENTRY.id);
    });

    expect(result).toBe(false);
    expect(finishMock).not.toHaveBeenCalled();
    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
    expect(hook.errorMessage).toBe('Solo podés marcar como cocinada una comida de hoy.');
    expect(hook.summary).toBeNull();
  });

  it('leaves the entry uncooked when the finish fails', async () => {
    startMock.mockResolvedValue(COOKING_START);
    finishMock.mockRejectedValue(new ApiError('inventory_mutation_failed', 'x', 500));

    await act(async () => {
      await hook.markAsCooked(ENTRY.id);
    });

    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
    expect(hook.errorMessage).toContain('No pudimos descontar los ingredientes');
  });

  // A finish whose answer was lost already cooked the meal; the retry hears it is finished.
  it.each([
    ['the finish', () => finishMock],
    ['the start', () => startMock],
  ])(
    'treats cooking_already_finished from %s as success: marks the entry and says it was cooked',
    async (_step, refusing) => {
      startMock.mockResolvedValue(COOKING_START);
      refusing().mockRejectedValue(new ApiError('cooking_already_finished', 'x', 409));

      let result: boolean | undefined;
      await act(async () => {
        result = await hook.markAsCooked(ENTRY.id);
      });

      expect(result).toBe(true);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
      expect(hook.summary).toBeNull();
      expect(hook.errorMessage).toBe('Esta comida ya figura como cocinada.');
      expect(hook.isPending).toBe(false);

      act(() => hook.dismiss());
      expect(hook.errorMessage).toBeNull();
      expect(hook.leftoverPrompt).toBeNull();
    }
  );

  it('ignores a second tap while the first is in flight', async () => {
    let release: (value: typeof COOKING_START) => void = () => {};
    startMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    finishMock.mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = hook.markAsCooked(ENTRY.id);
    });
    expect(hook.isPending).toBe(true);

    let second: boolean | undefined;
    await act(async () => {
      second = await hook.markAsCooked(ENTRY.id);
    });
    await act(async () => {
      release(COOKING_START);
      await first;
    });

    expect(second).toBe(false);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('clears the summary and the error on dismiss', async () => {
    startMock.mockResolvedValue(COOKING_START);
    finishMock.mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);
    await act(async () => {
      await hook.markAsCooked(ENTRY.id);
    });

    act(() => hook.dismiss());

    expect(hook.summary).toBeNull();
    expect(hook.errorMessage).toBeNull();
  });

  describe('the leftover prompt', () => {
    async function cook() {
      startMock.mockResolvedValue(COOKING_START);
      finishMock.mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);
      await act(async () => {
        await hook.markAsCooked(ENTRY.id);
      });
    }

    it('stays closed while the result of the finish is on screen', async () => {
      await cook();

      expect(hook.leftoverPrompt).toBeNull();
    });

    it('opens for the cooked meal when a successful result is closed', async () => {
      await cook();

      act(() => hook.dismiss());

      expect(hook.leftoverPrompt).toMatchObject({
        scheduledMealId: COOKING_SCHEDULED_MEAL_ID,
        recipeName: 'Arroz con aceite',
        consumed: [
          { name: 'Arroz', unit: 'g' },
          { name: 'Aceite de oliva', unit: 'ml' },
        ],
      });
    });

    it('does not open when the result that is closed is an error', async () => {
      startMock.mockRejectedValue(new ApiError('cooking_chat_unavailable', 'no', 422));
      await act(async () => {
        await hook.markAsCooked(ENTRY.id);
      });

      act(() => hook.dismiss());

      expect(hook.leftoverPrompt).toBeNull();
    });

    it('clears when it is closed and does not open again for the same finish', async () => {
      await cook();
      act(() => hook.dismiss());

      act(() => hook.closeLeftoverPrompt());
      expect(hook.leftoverPrompt).toBeNull();

      act(() => hook.dismiss());
      expect(hook.leftoverPrompt).toBeNull();
    });

    it('stays open when the result is dismissed a second time', async () => {
      await cook();
      act(() => hook.dismiss());

      act(() => hook.dismiss());

      expect(hook.leftoverPrompt?.scheduledMealId).toBe(COOKING_SCHEDULED_MEAL_ID);
    });
  });

  // Issue #145: a past meal is confirmed without a Cooking session.
  describe('confirmPastMeal', () => {
    it('confirms a past meal cooked: no session, the summary and the local mark', async () => {
      confirmMock.mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);

      let result: boolean | undefined;
      await act(async () => {
        result = await hook.confirmPastMeal(ENTRY.id, true);
      });

      expect(confirmMock).toHaveBeenCalledWith(ENTRY.id, true);
      expect(startMock).not.toHaveBeenCalled();
      expect(finishMock).not.toHaveBeenCalled();
      expect(result).toBe(true);
      expect(hook.summary?.shortages).toHaveLength(1);
      expect(useMealPlanStore.getState().entries[0]).toMatchObject({ isCooked: true });

      act(() => hook.dismiss());
      expect(hook.leftoverPrompt?.scheduledMealId).toBe(COOKING_SCHEDULED_MEAL_ID);
    });

    it('confirms a past meal not cooked: the entry is skipped and nothing is summarized', async () => {
      confirmMock.mockResolvedValue({
        scheduledMeal: { ...COOKING_FINISH_WITH_SHORTAGE.scheduledMeal, isSkipped: true },
        inventoryMutations: [],
        shortages: [],
      } as never);

      let result: boolean | undefined;
      await act(async () => {
        result = await hook.confirmPastMeal(ENTRY.id, false);
      });

      expect(confirmMock).toHaveBeenCalledWith(ENTRY.id, false);
      expect(result).toBe(true);
      expect(hook.summary).toBeNull();
      expect(hook.errorMessage).toBeNull();
      expect(useMealPlanStore.getState().entries[0]).toMatchObject({
        isCooked: false,
        isSkipped: true,
      });
    });

    it.each([true, false])(
      'leaves the entry as it was when the server refuses cooked: %s, and says why',
      async (cooked) => {
        confirmMock.mockRejectedValue(
          new ApiError('meal_already_confirmed', 'Already confirmed', 409)
        );

        let result: boolean | undefined;
        await act(async () => {
          result = await hook.confirmPastMeal(ENTRY.id, cooked);
        });

        expect(result).toBe(false);
        expect(hook.errorMessage).toBe('Esta comida ya tenía una respuesta. No se cambió nada.');
        expect(hook.summary).toBeNull();
        expect(useMealPlanStore.getState().entries[0]).toEqual(ENTRY);
      }
    );
  });
});
