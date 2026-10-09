import { act, create } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { finishCookingSession, startCookingSession } from '@/features/cooking/api';
import {
  COOKING_FINISH_WITH_SHORTAGE,
  COOKING_SCHEDULED_MEAL_ID,
  COOKING_START,
} from '@/features/cooking/fixtures';
import { useMealPlanStore } from '@/store';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import type { MealPlanEntry } from '@/types/domain';
import { useRecipeScreen } from '../useRecipeScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/features/cooking/api', () => ({
  startCookingSession: jest.fn(),
  finishCookingSession: jest.fn(),
}));
jest.mock('react-native/Libraries/Components/Keyboard/Keyboard', () => ({
  __esModule: true,
  default: { dismiss: jest.fn() },
}));

// The inventory barrel pulls in screens that need the native animation runtime.
jest.mock('@/features/inventory', () => ({
  useInventoryStore: (select: (state: unknown) => unknown) =>
    select({ items: [], ingredients: [] }),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1', entryId: 'fa64644f-e007-4539-9cd6-2a9d49570540' }),
  useRouter: () => ({ back: mockBack }),
}));
jest.mock('../useRecipe', () => ({
  useRecipe: () => ({ recipe: null, status: 'ready', retry: jest.fn() }),
}));

const ENTRY: MealPlanEntry = {
  id: COOKING_SCHEDULED_MEAL_ID,
  date: formatDateKey(new Date()),
  type: 'lunch',
  recipeId: 'r1',
  isCooked: false,
};

let screen: ReturnType<typeof useRecipeScreen>;
let tree: ReturnType<typeof create> | null = null;

function Harness() {
  // eslint-disable-next-line react-hooks/globals -- Test harness captures the hook result.
  screen = useRecipeScreen();
  return null;
}

async function confirmCooked() {
  act(() => screen.handleRequestMarkAsCooked());
  await act(async () => {
    await screen.handleConfirmCooked();
  });
}

describe('useRecipeScreen marking the meal as cooked', () => {
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

  it('shows the summary and goes back only when it is closed', async () => {
    jest.mocked(startCookingSession).mockResolvedValue(COOKING_START);
    jest.mocked(finishCookingSession).mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);

    await confirmCooked();

    expect(screen.cookingSummary?.recipeName).toBe('Arroz con aceite');
    expect(mockBack).not.toHaveBeenCalled();

    act(() => screen.handleCloseCookingResult());

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('stays on the recipe and shows the error when the server refuses', async () => {
    jest
      .mocked(startCookingSession)
      .mockRejectedValue(new ApiError('cooking_chat_unavailable', 'no', 422));

    await confirmCooked();
    expect(screen.cookingErrorMessage).toBe('Solo podés marcar como cocinada una comida de hoy.');

    act(() => screen.handleCloseCookingResult());

    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.cookingErrorMessage).toBeNull();
  });
});
