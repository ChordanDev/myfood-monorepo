import React from 'react';
import { act, create } from 'react-test-renderer';
import { useFavoritesStore } from '@/features/favorites/store';
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
jest.mock('../../hooks/useHomeRecipeTheme', () => ({
  useHomeRecipeTheme: () => ({ colorDark: '#111', appBg: '#fff' }),
}));
jest.mock('../../hooks/useHomeState', () => ({
  useHomeState: () => ({
    selectedDate: '2099-01-01',
    selectedMealType: 'lunch',
    availableMealTypes: ['lunch'],
    selectedMeal: { id: 'entry-1', recipeId: 'r1', type: 'lunch', description: '' },
    selectedDayMeals: [],
    isPendingConfirmationDay: false,
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
jest.mock('@/features/cooking', () => ({
  CookingResultSheet: 'CookingResultSheet',
  useMarkAsCooked: () => ({
    markAsCooked: jest.fn(),
    summary: null,
    errorMessage: null,
    dismiss: jest.fn(),
  }),
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
