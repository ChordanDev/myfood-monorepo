import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { useInventoryStore, useMealPlanStore } from '@/store';
import { useShoppingRequestsStore } from '@/store/useShoppingRequestsStore';
import type { MasterRecipe, MealPlanEntry, RecipeThemeConfig } from '@/types/domain';
import { RecipeScreen } from '../RecipeScreen';

const mockBack = jest.fn();
let mockRouteParams: { id: string; entryId?: string };

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRouteParams,
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/components', () => ({
  ShadowSurface: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/TopGradientBackground', () => ({
  TopGradientBackground: () => null,
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      alert: '#aa0000',
      appBg: '#ffffff',
      colorBlack: '#000001',
      colorDark: '#111111',
      colorLight: '#eeeeee',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      textBlack: '#111112',
      textDark: '#111113',
      textLight: '#fafafa',
    },
    setRecipeTheme: jest.fn(),
  }),
}));

const TODAY = formatDateKey(new Date());
const OTHER_DAY = '2020-01-15';

const RECIPE: MasterRecipe = {
  id: 'r1',
  name: 'Pollo con arroz y tomate',
  description: '',
  estimatedCost: 15,
  tags: [],
  ingredients: [
    { ingredientId: 'i1', amount: 100 },
    { ingredientId: 'i2', amount: 200 },
    { ingredientId: 'i3', amount: 2 },
  ],
  steps: [
    { order: 1, instruction: 'Cocinar el arroz.' },
    { order: 2, instruction: 'Saltear el pollo.' },
  ],
  theme: {} as RecipeThemeConfig,
};

function entry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e-today',
    date: TODAY,
    type: 'almuerzo',
    recipeId: 'r1',
    isCooked: false,
    ...overrides,
  };
}

let mountedTree: ReactTestRenderer | null = null;

function renderScreen() {
  act(() => {
    mountedTree = create(<RecipeScreen />);
  });

  return mountedTree!;
}

function renderedTexts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => String(node.props.children));
}

function findButton(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({ testID, accessibilityRole: 'button' });
}

function press(tree: ReactTestRenderer, testID: string) {
  act(() => {
    findButton(tree, testID).props.onPress();
  });
}

describe('RecipeScreen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockRouteParams = { id: 'r1', entryId: 'e-today' };
    useMealPlanStore.setState({ entries: [entry()], recipes: [RECIPE], favoriteRecipeIds: [] });
    useInventoryStore.setState({
      items: [{ ingredientId: 'i1', amount: 500 }],
      ingredients: [
        { id: 'i1', name: 'Arroz Blanco', category: 'despensa', basePrice: 2, unit: 'gramos' },
        { id: 'i2', name: 'Pollo (Pechuga)', category: 'proteinas', basePrice: 10, unit: 'gramos' },
        { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unidades' },
      ],
    });
    useShoppingRequestsStore.setState({ requests: [] });
  });

  // A screen left mounted would re-render, outside `act`, when the next test resets the stores.
  afterEach(() => {
    act(() => {
      mountedTree?.unmount();
    });
    mountedTree = null;
  });

  it('shows the recipe name, its ingredients with their stock state and its steps', () => {
    const texts = renderedTexts(renderScreen());

    expect(texts).toEqual(
      expect.arrayContaining([
        'Pollo con arroz y tomate',
        '100 g',
        'Arroz blanco',
        'En stock',
        '200 g',
        'Pollo (pechuga)',
        '2 u',
        'Tomate',
        '2 te faltan',
        '2 pasos',
        'Cocinar el arroz.',
        'Saltear el pollo.',
      ])
    );
    expect(texts.filter((text) => text === 'Falta · agregar')).toHaveLength(2);
  });

  it('sends a missing ingredient to the shopping requests and shows it as already in the list', () => {
    const tree = renderScreen();

    press(tree, 'recipe-ingredient-add-i2');

    expect(useShoppingRequestsStore.getState().requests).toEqual([
      expect.objectContaining({
        name: 'Pollo (pechuga)',
        ingredientId: 'i2',
        amount: 200,
        unit: 'gramos',
      }),
    ]);
    expect(tree.root.findAllByProps({ testID: 'recipe-ingredient-add-i2' })).toHaveLength(0);
    expect(renderedTexts(tree)).toContain('En la lista');
  });

  it('asks only for the amount the inventory is short of', () => {
    useInventoryStore.setState({
      items: [
        { ingredientId: 'i1', amount: 500 },
        { ingredientId: 'i2', amount: 50 },
      ],
    });
    const tree = renderScreen();

    press(tree, 'recipe-ingredient-add-i2');

    expect(useShoppingRequestsStore.getState().requests[0]).toMatchObject({ amount: 150 });
  });

  it('marks the planned meal as cooked and goes back', () => {
    const tree = renderScreen();

    press(tree, 'recipe-header-cooked');

    expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('stands for the planned meal of the route when the recipe is planned on several days', () => {
    useMealPlanStore.setState({
      entries: [entry(), entry({ id: 'e-cooked', date: OTHER_DAY, isCooked: true })],
    });
    mockRouteParams = { id: 'r1', entryId: 'e-cooked' };

    const tree = renderScreen();

    expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(true);
  });

  it('toggles the recipe as a favorite', () => {
    const tree = renderScreen();

    press(tree, 'recipe-header-favorite');

    expect(useMealPlanStore.getState().favoriteRecipeIds).toEqual(['r1']);
    expect(findButton(tree, 'recipe-header-favorite').props.accessibilityLabel).toBe(
      'Quitar de favoritos'
    );
  });

  it('goes back from the header', () => {
    const tree = renderScreen();

    press(tree, 'recipe-header-back');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('explains that the recipe was not found and still lets the user go back', () => {
    mockRouteParams = { id: 'missing' };
    const tree = renderScreen();

    expect(renderedTexts(tree)).toEqual(['No encontramos esta receta']);

    press(tree, 'recipe-header-back');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
