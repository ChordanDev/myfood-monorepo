import { act, create } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { addExtraItem } from '@/features/inventory/api';
import { buildInventoryItem, mutationEvent } from '@/features/inventory/mocks';
import { useInventoryStore } from '@/features/inventory/store';
import { createPreparedLeftover } from '@/features/leftovers/api/leftoversApi';
import { LEFTOVER_LENTILS } from '@/features/leftovers/fixtures';
import { summarizeCookingFinish, type CookingSummary } from '../domain';
import {
  COOKING_FINISH_COVERED,
  COOKING_FINISH_NOTHING_CONSUMED,
  COOKING_FINISH_THREE_INGREDIENTS,
  COOKING_SCHEDULED_MEAL_ID,
} from '../fixtures';
import { useLeftoverPrompt } from './useLeftoverPrompt';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
// Only the API layer is replaced: the writes go through the real inventory store.
jest.mock('@/features/inventory/api', () => ({
  addExtraItem: jest.fn(),
  applyVoice: jest.fn(),
  disposeItem: jest.fn(),
  getInventory: jest.fn(),
  setItemQuantity: jest.fn(),
}));
jest.mock('@/features/leftovers/api/leftoversApi', () => ({
  createPreparedLeftover: jest.fn(),
}));

const addExtraMock = jest.mocked(addExtraItem);
const createPreparedMock = jest.mocked(createPreparedLeftover);

// Rice, oil and an onion were deducted.
const SUMMARY = summarizeCookingFinish(COOKING_FINISH_THREE_INGREDIENTS);
const [RICE_LINE, OIL_LINE, ONION_LINE] = SUMMARY.consumed;

// The lots add-extra answers with: new ones, flagged as leftovers.
const RICE_LEFTOVER = buildInventoryItem({
  id: 'b2000000-0000-4000-8000-000000000001',
  ingredientId: RICE_LINE.ingredientId,
  name: 'Arroz',
  quantityMilli: 50_000,
  unit: 'g',
  sourceKind: 'extra',
  isLeftover: true,
});
const OIL_LEFTOVER = buildInventoryItem({
  id: 'b2000000-0000-4000-8000-000000000002',
  ingredientId: OIL_LINE.ingredientId,
  name: 'Aceite de oliva',
  quantityMilli: 10_000,
  unit: 'ml',
  sourceKind: 'extra',
  isLeftover: true,
});
const ONION_LEFTOVER = buildInventoryItem({
  id: 'b2000000-0000-4000-8000-000000000003',
  ingredientId: ONION_LINE.ingredientId,
  name: 'Cebolla',
  quantityMilli: 500,
  unit: 'unit',
  sourceKind: 'extra',
  isLeftover: true,
});

function written(item: typeof RICE_LEFTOVER) {
  return { item, mutationEvent: mutationEvent(item, { operation: 'add' }) };
}

const onClose = jest.fn();
let prompt: ReturnType<typeof useLeftoverPrompt>;
let tree: ReturnType<typeof create> | null = null;

// Wired as the screens wire it: Inventory through its store, Prepared leftovers through the API.
function Harness({ summary }: { summary: CookingSummary | null }) {
  const addExtra = useInventoryStore((state) => state.addExtra);
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result.
  prompt = useLeftoverPrompt({
    summary,
    onAddIngredient: addExtra,
    onCreatePrepared: createPreparedLeftover,
    onClose,
  });
  return null;
}

function open(summary: CookingSummary | null = SUMMARY) {
  act(() => {
    tree = create(<Harness summary={summary} />);
  });
}

function typeQuantity(line: (typeof SUMMARY.consumed)[number], text: string) {
  act(() => prompt.setLineQuantity(line, text));
}

function lineNames() {
  return prompt.lines.map((line) => line.name);
}

describe('useLeftoverPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useInventoryStore.setState({ items: [] });
  });

  afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
  });

  it('opens on the choices, with the ingredients that were deducted on offer', () => {
    open();

    expect(prompt.step).toBe('choices');
    expect(prompt.offersIngredients).toBe(true);
    expect(lineNames()).toEqual(['Arroz', 'Aceite de oliva', 'Cebolla']);
    expect(prompt.lines.every((line) => line.quantityText === '')).toBe(true);
  });

  it('does not offer the ingredients when nothing was deducted', () => {
    open(summarizeCookingFinish(COOKING_FINISH_NOTHING_CONSUMED));

    expect(prompt.offersIngredients).toBe(false);
    expect(prompt.lines).toEqual([]);
  });

  it('sends nothing when nothing was left', () => {
    open();

    act(() => prompt.close());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(addExtraMock).not.toHaveBeenCalled();
    expect(createPreparedMock).not.toHaveBeenCalled();
  });

  it('goes back from a step to the choices', () => {
    open();

    act(() => prompt.choose('ingredients'));
    expect(prompt.step).toBe('ingredients');

    act(() => prompt.back());
    expect(prompt.step).toBe('choices');

    act(() => prompt.choose('prepared'));
    expect(prompt.step).toBe('prepared');
  });

  describe('ingredients', () => {
    it('cannot be saved until a quantity is filled, and every filled one is above zero', () => {
      open();
      act(() => prompt.choose('ingredients'));
      expect(prompt.canSaveIngredients).toBe(false);

      typeQuantity(RICE_LINE, '50');
      expect(prompt.canSaveIngredients).toBe(true);

      typeQuantity(OIL_LINE, '0');
      expect(prompt.canSaveIngredients).toBe(false);
    });

    it('sends each filled line as a leftover lot and leaves Inventory as the server answered', async () => {
      addExtraMock
        .mockResolvedValueOnce(written(RICE_LEFTOVER))
        .mockResolvedValueOnce(written(ONION_LEFTOVER));
      open();
      act(() => prompt.choose('ingredients'));
      typeQuantity(RICE_LINE, '50');
      typeQuantity(ONION_LINE, '0,5');

      await act(async () => {
        await prompt.saveIngredients();
      });

      expect(addExtraMock.mock.calls).toEqual([
        [
          {
            ingredientId: RICE_LINE.ingredientId,
            quantityMilli: 50_000,
            unit: 'g',
            isLeftover: true,
          },
        ],
        [
          {
            ingredientId: ONION_LINE.ingredientId,
            quantityMilli: 500,
            unit: 'unit',
            isLeftover: true,
          },
        ],
      ]);
      expect(useInventoryStore.getState().items).toEqual([RICE_LEFTOVER, ONION_LEFTOVER]);
      expect(useInventoryStore.getState().items.every((item) => item.isLeftover)).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(prompt.errorMessage).toBeNull();
    });

    it('sends nothing while a filled quantity is not valid', async () => {
      open();
      act(() => prompt.choose('ingredients'));
      typeQuantity(RICE_LINE, '50');
      typeQuantity(OIL_LINE, 'mucho');

      await act(async () => {
        await prompt.saveIngredients();
      });

      expect(addExtraMock).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('keeps what was not saved when a line fails, and a retry sends only that', async () => {
      addExtraMock
        .mockResolvedValueOnce(written(RICE_LEFTOVER))
        .mockRejectedValueOnce(new ApiError('validation_error', 'no', 422))
        .mockResolvedValueOnce(written(OIL_LEFTOVER));
      open();
      act(() => prompt.choose('ingredients'));
      typeQuantity(RICE_LINE, '50');
      typeQuantity(OIL_LINE, '10');

      await act(async () => {
        await prompt.saveIngredients();
      });

      expect(prompt.errorMessage).toBe('Los datos ingresados no son válidos.');
      expect(onClose).not.toHaveBeenCalled();
      expect(prompt.step).toBe('ingredients');
      // The rice is in Inventory, so it is gone; the oil keeps what was typed.
      expect(lineNames()).toEqual(['Aceite de oliva', 'Cebolla']);
      expect(prompt.lines[0].quantityText).toBe('10');
      expect(useInventoryStore.getState().items).toEqual([RICE_LEFTOVER]);

      await act(async () => {
        await prompt.saveIngredients();
      });

      expect(addExtraMock).toHaveBeenCalledTimes(3);
      expect(addExtraMock).toHaveBeenLastCalledWith({
        ingredientId: OIL_LINE.ingredientId,
        quantityMilli: 10_000,
        unit: 'ml',
        isLeftover: true,
      });
      expect(useInventoryStore.getState().items).toEqual([RICE_LEFTOVER, OIL_LEFTOVER]);
      expect(prompt.errorMessage).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores a second submit and a close while the first submit is on its way', async () => {
      let answer: (value: ReturnType<typeof written>) => void = () => {};
      addExtraMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      open();
      act(() => prompt.choose('ingredients'));
      typeQuantity(RICE_LINE, '50');

      let first: Promise<void> | undefined;
      act(() => {
        first = prompt.saveIngredients();
      });
      expect(prompt.isPending).toBe(true);

      await act(async () => {
        await prompt.saveIngredients();
        prompt.close();
        prompt.back();
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(prompt.step).toBe('ingredients');

      await act(async () => {
        answer(written(RICE_LEFTOVER));
        await first;
      });

      expect(addExtraMock).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(prompt.isPending).toBe(false);
    });
  });

  describe('prepared food', () => {
    it('proposes the recipe as the title and one portion', () => {
      open();
      act(() => prompt.choose('prepared'));

      expect(prompt.title).toBe('Arroz con aceite');
      expect(prompt.portionsText).toBe('1');
      expect(prompt.canSavePrepared).toBe(true);
    });

    it('creates the Prepared leftover of the Scheduled meal and closes', async () => {
      createPreparedMock.mockResolvedValue(LEFTOVER_LENTILS);
      open();
      act(() => prompt.choose('prepared'));
      act(() => prompt.setPortionsText('2'));

      await act(async () => {
        await prompt.savePrepared();
      });

      expect(createPreparedMock.mock.calls).toEqual([
        [{ title: 'Arroz con aceite', portions: 2, scheduledMealId: COOKING_SCHEDULED_MEAL_ID }],
      ]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('sends an edited title without the spaces around it', async () => {
      createPreparedMock.mockResolvedValue(LEFTOVER_LENTILS);
      open();
      act(() => prompt.choose('prepared'));
      act(() => prompt.setTitle('  Arroz de ayer '));

      await act(async () => {
        await prompt.savePrepared();
      });

      expect(createPreparedMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Arroz de ayer', portions: 1 })
      );
    });

    it.each([
      ['a blank title', '   ', '1'],
      ['no portions', 'Arroz', '0'],
      ['half a portion', 'Arroz', '1,5'],
    ])('cannot be saved with %s', async (_case, title, portionsText) => {
      open();
      act(() => prompt.choose('prepared'));
      act(() => {
        prompt.setTitle(title);
        prompt.setPortionsText(portionsText);
      });

      expect(prompt.canSavePrepared).toBe(false);
      await act(async () => {
        await prompt.savePrepared();
      });

      expect(createPreparedMock).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('stays open and says why when the server refuses', async () => {
      createPreparedMock.mockRejectedValue(
        new ApiError('scheduled_meal_not_found', 'Scheduled meal not found', 404)
      );
      open();
      act(() => prompt.choose('prepared'));

      await act(async () => {
        await prompt.savePrepared();
      });

      expect(prompt.errorMessage).toEqual(expect.any(String));
      expect(prompt.errorMessage).not.toBe('');
      expect(prompt.step).toBe('prepared');
      expect(onClose).not.toHaveBeenCalled();

      // The message belongs to the step that failed.
      act(() => prompt.back());
      expect(prompt.errorMessage).toBeNull();
    });
  });

  it('sends nothing from a late press once it is closed', async () => {
    open();
    act(() => prompt.choose('ingredients'));
    typeQuantity(RICE_LINE, '50');

    // The sheet stays on screen while it fades out.
    act(() => tree!.update(<Harness summary={null} />));
    await act(async () => {
      await prompt.saveIngredients();
    });

    expect(addExtraMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts over for the next finish', () => {
    open();
    act(() => prompt.choose('ingredients'));
    typeQuantity(RICE_LINE, '50');

    act(() => tree!.update(<Harness summary={null} />));
    act(() => tree!.update(<Harness summary={summarizeCookingFinish(COOKING_FINISH_COVERED)} />));

    expect(prompt.step).toBe('choices');
    expect(lineNames()).toEqual(['Arroz', 'Aceite de oliva']);
    expect(prompt.lines.every((line) => line.quantityText === '')).toBe(true);
  });
});
