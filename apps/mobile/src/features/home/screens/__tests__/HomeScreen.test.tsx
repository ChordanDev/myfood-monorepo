import React from 'react';
import { act, create } from 'react-test-renderer';
import { summarizeCookingFinish } from '@/features/cooking/domain';
import { COOKING_FINISH_COVERED } from '@/features/cooking/fixtures';
import { useFavoritesStore } from '@/features/favorites/store';
import { createPreparedLeftover } from '@/features/leftovers';
import { formatDateKey } from '../../utils/calendarDate';
import { HomeScreen } from '../HomeScreen';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/components', () => ({
  AddCircleButton: 'AddCircleButton',
  NoisyBackground: 'NoisyBackground',
  SafeAreaContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TitlePrimary: 'TitlePrimary',
}));
jest.mock('@/hooks/useGradientCrossfade', () => ({
  useGradientCrossfade: (colors: string[]) => ({
    currentColors: colors,
    previousColors: colors,
    animatedStyle: {},
    AnimatedView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }),
}));
jest.mock('../../hooks/useHomeResponsiveScale', () => ({ useHomeResponsiveScale: () => ({}) }));
// The image of the selected meal's Recipe, as `useHomeRecipeTheme` resolves it; none by default.
let mockMealImageUrl: string | null = null;
jest.mock('../../hooks/useHomeRecipeTheme', () => ({
  useHomeRecipeTheme: () => ({
    theme: { colorDark: '#111', appBg: '#fff' },
    imageUrl: mockMealImageUrl,
  }),
}));
let mockSelectedDate = '2099-01-01';
let mockIsPendingConfirmationDay = false;
jest.mock('../../hooks/useHomeState', () => ({
  useHomeState: () => ({
    selectedDate: mockSelectedDate,
    selectedMealType: 'lunch',
    availableMealTypes: ['lunch'],
    selectedMeal: { id: 'entry-1', recipeId: 'r1', type: 'lunch', description: '' },
    selectedDayMeals: [],
    isPendingConfirmationDay: mockIsPendingConfirmationDay,
    planByDate: {},
    handleSelectDate: jest.fn(),
    handleMealTypeChange: jest.fn(),
  }),
}));
jest.mock('../../components', () => ({
  Calendar: 'Calendar',
  CookedConfirmationCard: 'CookedConfirmationCard',
  EatTodayButton: 'EatTodayButton',
  EatTodaySheet: 'EatTodaySheet',
  FloatingFoodImage: 'FloatingFoodImage',
  FoodTypeSwitcher: 'FoodTypeSwitcher',
  PendingDayCard: 'PendingDayCard',
}));
jest.mock('../../components/FoodCard', () => ({ FoodCard: 'FoodCard' }));
// The finish the cooking flow asks about leftovers for; none until a test cooks.
let mockLeftoverPrompt: unknown = null;
const mockCloseLeftoverPrompt = jest.fn();
const mockConfirmPastMeal = jest.fn();
jest.mock('@/features/cooking', () => ({
  CookingResultSheet: 'CookingResultSheet',
  useMarkAsCooked: () => ({
    markAsCooked: jest.fn(),
    confirmPastMeal: mockConfirmPastMeal,
    summary: null,
    errorMessage: null,
    dismiss: jest.fn(),
    leftoverPrompt: mockLeftoverPrompt,
    closeLeftoverPrompt: mockCloseLeftoverPrompt,
  }),
}));
// The barrels also export screens the mocks above cannot load; Home only needs the two writes.
const mockAddExtra = jest.fn();
jest.mock('@/features/inventory', () => ({
  useInventoryStore: (select: (state: unknown) => unknown) => select({ addExtra: mockAddExtra }),
}));
jest.mock('@/features/leftovers', () => ({ createPreparedLeftover: jest.fn() }));
const mockEatToday = jest.fn();
jest.mock('../../hooks/useEatToday', () => ({ useEatToday: () => mockEatToday }));
const mockRefreshLivePlan = jest.fn();
jest.mock('../../hooks/useLoadLivePlan', () => ({
  useLoadLivePlan: jest.fn(),
  refreshLivePlan: () => mockRefreshLivePlan(),
}));

function mount() {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<HomeScreen />);
  });
  return tree!;
}

beforeEach(() => {
  useFavoritesStore.setState({ favorites: [] });
});

describe('HomeScreen favorite star', () => {
  it('is filled when the favorites store holds the selected recipe', () => {
    useFavoritesStore.setState({
      favorites: [{ recipeId: 'r1', name: 'Pollo', mainIngredients: [], durationMinutes: null }],
    });

    const card = mount().root.findByType('FoodCard' as never);

    expect(card.props.isFavorite).toBe(true);
  });

  it('toggles through the favorites store', () => {
    const toggle = jest.fn().mockResolvedValue(true);
    useFavoritesStore.setState({ toggle });
    const card = mount().root.findByType('FoodCard' as never);

    act(() => card.props.onToggleFavorite());

    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ recipeId: 'r1' }));
  });
});

describe('HomeScreen food image', () => {
  beforeEach(() => {
    mockSelectedDate = formatDateKey(new Date());
  });

  afterEach(() => {
    mockSelectedDate = '2099-01-01';
    mockMealImageUrl = null;
  });

  it("shows the image of today's selected meal's Recipe", () => {
    mockMealImageUrl = 'https://img.example/lunch.png';

    const image = mount().root.findByType('FloatingFoodImage' as never);

    expect(image.props.source).toEqual({ uri: 'https://img.example/lunch.png' });
  });

  it('shows the default image while the Recipe has no image', () => {
    const image = mount().root.findByType('FloatingFoodImage' as never);

    expect(image.props.source).not.toEqual(expect.objectContaining({ uri: expect.anything() }));
    expect(image.props.source).toBeTruthy();
  });
});

describe('HomeScreen leftover prompt', () => {
  afterEach(() => {
    mockLeftoverPrompt = null;
  });

  it('stays closed while no finish asks about leftovers', () => {
    const sheet = mount().root.findByType('CookingResultSheet' as never);

    expect(sheet.props.leftoverPrompt).toBeNull();
  });

  it('asks about the finish, writing through the Inventory store and the leftovers API', () => {
    mockLeftoverPrompt = summarizeCookingFinish(COOKING_FINISH_COVERED);

    const sheet = mount().root.findByType('CookingResultSheet' as never);

    expect(sheet.props.leftoverPrompt).toBe(mockLeftoverPrompt);
    expect(sheet.props.onAddLeftoverIngredient).toBe(mockAddExtra);
    expect(sheet.props.onCreatePreparedLeftover).toBe(createPreparedLeftover);
    expect(sheet.props.onCloseLeftoverPrompt).toBe(mockCloseLeftoverPrompt);
  });
});

// Issue #146: a move to today that did not go as asked is told to the User.
describe('HomeScreen eat today', () => {
  it('opens the sheet again with the message of a move that did not go as asked', async () => {
    mockEatToday.mockResolvedValue({
      moved: false,
      errorMessage: 'No encontramos esa comida en tu plan.',
    });
    const tree = mount();

    await act(async () => {
      await tree.root.findByType('EatTodaySheet' as never).props.onSelect('dinner');
    });

    const sheet = tree.root.findByType('EatTodaySheet' as never);
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.errorMessage).toBe('No encontramos esa comida en tu plan.');
  });

  it('keeps the sheet closed after a move that went well', async () => {
    mockEatToday.mockResolvedValue({ moved: true, errorMessage: null });
    const tree = mount();

    await act(async () => {
      await tree.root.findByType('EatTodaySheet' as never).props.onSelect('dinner');
    });

    expect(tree.root.findByType('EatTodaySheet' as never).props.visible).toBe(false);
  });
});

// Issue #145: both answers of the "did you eat it?" card go to the server.
describe('HomeScreen past meal confirmation', () => {
  beforeEach(() => {
    mockIsPendingConfirmationDay = true;
    mockSelectedDate = '2026-08-24';
    mockConfirmPastMeal.mockReset();
    mockRefreshLivePlan.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockIsPendingConfirmationDay = false;
    mockSelectedDate = '2099-01-01';
  });

  it.each([
    ['onConfirmCooked', true],
    ['onConfirmSkipped', false],
  ])('%s sends cooked: %s for the selected meal to the server', async (handler, cooked) => {
    mockConfirmPastMeal.mockResolvedValue(true);
    const card = mount().root.findByType('CookedConfirmationCard' as never);

    await act(async () => card.props[handler]());

    expect(mockConfirmPastMeal).toHaveBeenCalledWith('entry-1', cooked);
    expect(mockRefreshLivePlan).not.toHaveBeenCalled();
  });

  it('reads the plan again when the server refuses the answer', async () => {
    mockConfirmPastMeal.mockResolvedValue(false);
    const card = mount().root.findByType('CookedConfirmationCard' as never);

    await act(async () => card.props.onConfirmSkipped());

    expect(mockConfirmPastMeal).toHaveBeenCalledWith('entry-1', false);
    expect(mockRefreshLivePlan).toHaveBeenCalledTimes(1);
  });
});
