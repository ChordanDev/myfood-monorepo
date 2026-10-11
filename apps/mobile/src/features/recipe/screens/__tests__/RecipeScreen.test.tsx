import React from 'react';
import { Keyboard, Modal, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { CHAT_COMPOSER_MIN_HEIGHT } from '@/features/assistant-chat';
import { addFavorite, listFavorites, removeFavorite } from '@/features/favorites/api/favoritesApi';
import { useFavoritesStore } from '@/features/favorites/store';
import {
  askCookingSession,
  finishCookingSession,
  getCookingSession,
  startCookingSession,
} from '@/features/cooking/api';
import {
  COOKING_ANSWER,
  COOKING_FINISH_WITH_SHORTAGE,
  COOKING_SESSION_FINISHED,
  COOKING_SESSION_WITH_HISTORY,
  COOKING_START,
} from '@/features/cooking/fixtures';
import { useInventoryStore, type InventoryItem } from '@/features/inventory';
import { useShoppingListStore } from '@/features/shopping/store';
import { useMealPlanStore } from '@/store';
import type { MealPlanEntry } from '@/types/domain';
import { RecipeBottomFade } from '../../components/RecipeBottomFade';
import { fixtureRecipe } from '../../fixtures/recipeDetail';
import recipeDetail from '../../fixtures/recipeDetail.json';
import { useRecipeCacheStore } from '../../store';
import type { Recipe } from '../../types/recipe';
import { RecipeScreen } from '../RecipeScreen';

const mockBack = jest.fn();

jest.mock('@/features/cooking/api', () => ({
  startCookingSession: jest.fn(),
  getCookingSession: jest.fn(),
  askCookingSession: jest.fn(),
  finishCookingSession: jest.fn(),
}));
const mockScrollToEnd = jest.fn();
const fetchMock = jest.fn();
let mockRouteParams: { id: string; entryId?: string; recipeVersionId?: string };

// The session of a signed-in user: every recipe request carries its access token.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('access-1')),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

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

// The mask is a host node, so the test can read where the screen puts it and how far it fades.
jest.mock('@/components', () => ({
  ShadowSurface: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TopFadeMask: 'TopFadeMask',
}));

jest.mock('../../components/RecipeTopGradient', () => ({
  RecipeTopGradient: () => null,
}));

// The scroll view is replaced by a host node, so the test can hand it a `scrollToEnd` to observe.
jest.mock('react-native', () => {
  const ReactMock = jest.requireActual('react') as typeof import('react');
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  const MockScrollView = (props: React.ComponentProps<typeof ReactNative.ScrollView>) =>
    ReactMock.createElement('RCTScrollView', props, props.children);

  MockScrollView.displayName = 'ScrollView';

  return Object.defineProperty(Object.create(ReactNative), 'ScrollView', {
    value: MockScrollView,
    enumerable: true,
  });
});

// The favorites are the server's: the API module is replaced, and the list read stays pending
// unless a test answers it.
jest.mock('@/features/favorites/api/favoritesApi', () => ({
  listFavorites: jest.fn(),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

// The composer and the typing indicator are covered by their own suites; here they are host nodes
// whose props show what the screen asks of them.
jest.mock('@/features/assistant-chat', () => ({
  ...jest.requireActual('@/features/assistant-chat/constants'),
  ChatComposer: 'ChatComposer',
  ChatTypingIndicator: 'ChatTypingIndicator',
}));

// The barrel also exports the inventory screen, which the partial mocks above cannot load; the
// recipe only reads the store, the same instance the meal plan consumes ingredients from.
jest.mock('@/features/inventory', () => ({
  useInventoryStore: jest.requireActual('@/features/inventory/store').useInventoryStore,
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
      primaryAccentIntense: '#ff3300',
      textBlack: '#111112',
      textDark: '#111113',
      textLight: '#fafafa',
    },
    setRecipeTheme: jest.fn(),
  }),
}));

const TODAY = formatDateKey(new Date());
const OTHER_DAY = '2020-01-15';

// The recipe of today's meal, whose ingredients are the ones the inventory catalog below has.
const RECIPE: Recipe = {
  id: 'r1',
  recipeVersionId: 'r1-version',
  successorRecipeId: null,
  source: 'traditional',
  name: 'Pollo con arroz y tomate',
  description: '',
  servings: null,
  durationMinutes: null,
  ingredients: [
    { ingredientId: 'i1', name: 'Arroz blanco', category: null, quantityMilli: 100_000, unit: 'g' },
    {
      ingredientId: 'i2',
      name: 'Pollo (pechuga)',
      category: null,
      quantityMilli: 200_000,
      unit: 'g',
    },
    { ingredientId: 'i3', name: 'Tomate', category: null, quantityMilli: 2_000, unit: 'unit' },
  ],
  steps: [
    { order: 1, text: 'Cocinar el arroz.', durationMinutes: null },
    { order: 2, text: 'Saltear el pollo.', durationMinutes: null },
  ],
  estimatedCostCents: 0,
  tags: [],
  imageUrl: null,
  theme: null,
};

// Puts a recipe in the version cache, as a recipe that was opened before is.
function seedCachedRecipe(recipe: Recipe) {
  useRecipeCacheStore.setState({
    recipesByVersionId: { [recipe.recipeVersionId]: recipe },
    versionIdByRecipeId: { [recipe.id]: recipe.recipeVersionId },
  });
}

function entry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e-today',
    date: TODAY,
    type: 'lunch',
    recipeId: 'r1',
    isCooked: false,
    ...overrides,
  };
}

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'inv-i1',
    ingredientId: 'i1',
    name: 'Arroz Blanco',
    category: 'no_perecederos',
    quantityMilli: 500_000,
    unit: 'g',
    sourceKind: 'planned',
    acquiredAt: null,
    expiresAt: '2026-12-01',
    freshness: 'ok',
    isLeftover: false,
    notes: null,
    ...overrides,
  };
}

let mountedTree: ReactTestRenderer | null = null;

function renderScreen() {
  act(() => {
    mountedTree = create(<RecipeScreen />, {
      createNodeMock: (element) =>
        element.type === 'RCTScrollView' ? { scrollToEnd: mockScrollToEnd } : null,
    });
  });

  return mountedTree!;
}

// For a test that waits for nothing else: the screen asks the cache for its recipe, and that
// answer lands a tick after the first paint.
async function renderSettledScreen() {
  const tree = renderScreen();
  await act(async () => {});

  return tree;
}

function unmountScreen() {
  act(() => {
    mountedTree?.unmount();
  });
  mountedTree = null;
}

function getComposer(tree: ReactTestRenderer) {
  return tree.root.findByProps({ testIDPrefix: 'recipe-composer' });
}

function getScrollView(tree: ReactTestRenderer) {
  return tree.root.findByType(ScrollView);
}

function ask(tree: ReactTestRenderer, question: string) {
  act(() => {
    getComposer(tree).props.onChangeText(question);
  });
  act(() => {
    getComposer(tree).props.onSubmit();
  });
}

// Lets the answers of the Cooking session calls land: the history, then the reply.
async function waitForReply() {
  await act(async () => {});
}

function renderedTexts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => String(node.props.children));
}

const FACT_LABELS = ['Rinde', 'Tiempo', 'Costo estimado'];

// The labels of the servings, duration and cost rows the screen draws; none when it knows none.
function shownFactLabels(tree: ReactTestRenderer) {
  return renderedTexts(tree).filter((text) => FACT_LABELS.includes(text));
}

function findButton(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({ testID, accessibilityRole: 'button' });
}

function press(tree: ReactTestRenderer, testID: string) {
  act(() => {
    findButton(tree, testID).props.onPress();
  });
}

async function pressAndSettle(tree: ReactTestRenderer, testID: string) {
  await act(async () => {
    findButton(tree, testID).props.onPress();
  });
}

// The Shopping list is the server's: the recipe neither reads it nor asks the server for it.
const shopping = () => useShoppingListStore.getState();

// What the row of an ingredient reads at its end: "En stock" or "Falta".
function ingredientStatus(tree: ReactTestRenderer, ingredientId: string) {
  const [row] = tree.root.findAllByProps({ testID: `recipe-ingredient-row-${ingredientId}` });

  return row.findAllByType(Text).map((node) => String(node.props.children))[2];
}

function hasAddAction(tree: ReactTestRenderer, ingredientId: string) {
  return tree.root.findAllByProps({ testID: `recipe-ingredient-add-${ingredientId}` }).length > 0;
}

describe('RecipeScreen', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    jest.useFakeTimers();
    mockBack.mockClear();
    jest.mocked(startCookingSession).mockReset().mockResolvedValue(COOKING_START);
    jest.mocked(finishCookingSession).mockReset().mockResolvedValue(COOKING_FINISH_WITH_SHORTAGE);
    // The chat of today's meal opens with the screen. Its history stays on its way unless a test
    // waits for it, so nothing lands after a test that never looks at the chat.
    jest
      .mocked(getCookingSession)
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    jest.mocked(askCookingSession).mockReset().mockResolvedValue(COOKING_ANSWER);
    mockScrollToEnd.mockClear();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
    useRecipeCacheStore.getState().clear();
    seedCachedRecipe(RECIPE);
    useFavoritesStore.getState().clear();
    jest
      .mocked(listFavorites)
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    jest.mocked(addFavorite).mockReset();
    jest.mocked(removeFavorite).mockReset();
    mockRouteParams = { id: 'r1', entryId: 'e-today' };
    useMealPlanStore.setState({ entries: [entry()] });
    useInventoryStore.setState({
      items: [inventoryItem()],
      ingredients: [
        { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
        { id: 'i2', name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
        { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
      ],
    });
  });

  // A screen left mounted would re-render, outside `act`, when the next test resets the stores.
  afterEach(() => {
    unmountScreen();
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it('shows the recipe name, its ingredients with their stock state and its steps', async () => {
    const texts = renderedTexts(await renderSettledScreen());

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
  });

  describe('ingredients the inventory is short of', () => {
    it('reads them as missing, with nothing to send to the shopping list', async () => {
      const tree = await renderSettledScreen();

      expect(ingredientStatus(tree, 'i1')).toBe('En stock');
      expect(ingredientStatus(tree, 'i2')).toBe('Falta');
      expect(ingredientStatus(tree, 'i3')).toBe('Falta');
      expect(hasAddAction(tree, 'i2')).toBe(false);
      expect(hasAddAction(tree, 'i3')).toBe(false);
      expect(renderedTexts(tree)).not.toContain('Falta · agregar');
      expect(renderedTexts(tree)).not.toContain('En la lista');
    });

    it('neither reads nor changes the shopping list, nor asks the server for it', async () => {
      const stateBefore = shopping();

      await renderSettledScreen();

      expect(shopping()).toBe(stateBefore);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads a partly stocked ingredient as missing', async () => {
      useInventoryStore.setState({
        items: [
          inventoryItem(),
          inventoryItem({
            id: 'inv-i2',
            ingredientId: 'i2',
            name: 'Pollo (Pechuga)',
            quantityMilli: 50_000,
          }),
        ],
      });
      const tree = await renderSettledScreen();

      expect(ingredientStatus(tree, 'i2')).toBe('Falta');
      expect(renderedTexts(tree)).toContain('2 te faltan');
    });

    it('does not count an inventory item without a catalog link as stock', async () => {
      useInventoryStore.setState({
        items: [
          inventoryItem(),
          inventoryItem({
            id: 'inv-free',
            ingredientId: undefined,
            name: 'Pollo',
            quantityMilli: 900_000,
          }),
        ],
      });
      const tree = await renderSettledScreen();

      expect(renderedTexts(tree)).toContain('2 te faltan');
      expect(ingredientStatus(tree, 'i2')).toBe('Falta');
    });

    it('shows an ingredient outside the catalog as missing, like the others', async () => {
      seedCachedRecipe({
        ...RECIPE,
        ingredients: [
          ...RECIPE.ingredients,
          {
            ingredientId: 'ghost',
            name: 'Ají molido',
            category: null,
            quantityMilli: 3_000,
            unit: 'unit',
          },
        ],
      });
      const tree = await renderSettledScreen();

      expect(ingredientStatus(tree, 'ghost')).toBe('Falta');
      expect(hasAddAction(tree, 'ghost')).toBe(false);
      expect(renderedTexts(tree)).toContain('3 te faltan');
    });
  });

  describe('marking the meal as cooked', () => {
    function isConfirmSheetOpen(tree: ReactTestRenderer) {
      return tree.root.findAllByProps({ testID: 'recipe-cooked-confirm-sheet' }).length > 0;
    }

    it('asks for confirmation instead of marking the meal right away', async () => {
      const tree = await renderSettledScreen();

      expect(isConfirmSheetOpen(tree)).toBe(false);

      press(tree, 'recipe-header-cooked');

      expect(isConfirmSheetOpen(tree)).toBe(true);
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['¿Cocinaste la receta?', 'Sí', 'No'])
      );
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('cooks through the server, shows what was consumed and goes back when it is closed', async () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      await pressAndSettle(tree, 'recipe-cooked-confirm-yes');

      expect(startCookingSession).toHaveBeenCalledWith('e-today');
      expect(finishCookingSession).toHaveBeenCalledWith(COOKING_START.sessionId);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['Esto se descontó de tu inventario', 'Arroz', '200 g', 'Sal'])
      );
      expect(mockBack).not.toHaveBeenCalled();

      press(tree, 'cooking-result-close');

      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('does not subtract anything from the local inventory', async () => {
      const tree = renderScreen();
      const before = useInventoryStore.getState().items;

      press(tree, 'recipe-header-cooked');
      await pressAndSettle(tree, 'recipe-cooked-confirm-yes');

      expect(useInventoryStore.getState().items).toEqual(before);
    });

    it('starts a single session when "Sí" is tapped twice', async () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      // Both taps land before the screen re-renders, so they reach the same handler.
      const { onPress } = findButton(tree, 'recipe-cooked-confirm-yes').props;
      await act(async () => {
        onPress();
        onPress();
      });

      // The chat opened the meal's session with the screen; cooking asked for it once more.
      expect(startCookingSession).toHaveBeenCalledTimes(2);
      expect(finishCookingSession).toHaveBeenCalledTimes(1);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
    });

    it('stays on the recipe, uncooked, and says why when the server refuses', async () => {
      jest
        .mocked(startCookingSession)
        .mockRejectedValue(new ApiError('cooking_chat_unavailable', 'no', 422));
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      await pressAndSettle(tree, 'recipe-cooked-confirm-yes');

      expect(renderedTexts(tree)).toContain('Solo podés marcar como cocinada una comida de hoy.');
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);

      press(tree, 'cooking-result-close');

      expect(mockBack).not.toHaveBeenCalled();
    });

    it('leaves the meal uncooked and the screen in place when the user answers "No"', async () => {
      const tree = await renderSettledScreen();

      press(tree, 'recipe-header-cooked');
      press(tree, 'recipe-cooked-confirm-no');

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
      expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(false);
    });

    it('asks again after a "No", and the next "Sí" still marks the meal', async () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      press(tree, 'recipe-cooked-confirm-no');
      press(tree, 'recipe-header-cooked');
      await pressAndSettle(tree, 'recipe-cooked-confirm-yes');

      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
    });

    it('closes without marking the meal from the backdrop and from the Android back button', async () => {
      const tree = await renderSettledScreen();

      press(tree, 'recipe-header-cooked');
      act(() => {
        tree.root
          .findAllByProps({ accessibilityLabel: 'Cerrar', accessibilityRole: 'button' })[0]
          .props.onPress();
      });

      expect(isConfirmSheetOpen(tree)).toBe(false);

      press(tree, 'recipe-header-cooked');
      act(() => {
        tree.root.findAllByType(Modal)[0].props.onRequestClose();
      });

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('does not ask when the meal cannot be marked, even if the disabled check is pressed', async () => {
      useMealPlanStore.setState({ entries: [entry({ isCooked: true })] });
      const tree = await renderSettledScreen();

      expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(true);

      press(tree, 'recipe-header-cooked');

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('does not ask for a meal that was skipped, and leaves it uncooked', async () => {
      useMealPlanStore.setState({ entries: [entry({ isSkipped: true })] });
      const tree = await renderSettledScreen();

      expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(true);

      press(tree, 'recipe-header-cooked');

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('dismisses the keyboard before asking, so the sheet is not opened over it', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
      const tree = await renderSettledScreen();

      press(tree, 'recipe-header-cooked');

      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(isConfirmSheetOpen(tree)).toBe(true);

      dismiss.mockRestore();
    });
  });

  it('stands for the planned meal of the route when the recipe is planned on several days', async () => {
    useMealPlanStore.setState({
      entries: [entry(), entry({ id: 'e-cooked', date: OTHER_DAY, isCooked: true })],
    });
    mockRouteParams = { id: 'r1', entryId: 'e-cooked' };

    const tree = await renderSettledScreen();

    expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(true);
  });

  it('reads the favorites so the star starts right', async () => {
    jest.mocked(listFavorites).mockResolvedValue([
      {
        recipeId: 'r1',
        name: 'Pollo con arroz y tomate',
        mainIngredients: [],
        durationMinutes: null,
      },
    ]);
    const tree = renderScreen();

    await act(async () => {});

    expect(listFavorites).toHaveBeenCalled();
    expect(findButton(tree, 'recipe-header-favorite').props.accessibilityLabel).toBe(
      'Quitar de favoritos'
    );
  });

  it('favorites the recipe at once, before the server answers', async () => {
    jest.mocked(addFavorite).mockReturnValue(new Promise(() => {}));
    const tree = await renderSettledScreen();

    press(tree, 'recipe-header-favorite');

    expect(addFavorite).toHaveBeenCalledWith('r1');
    expect(useFavoritesStore.getState().favorites).toEqual([
      {
        recipeId: 'r1',
        name: 'Pollo con arroz y tomate',
        mainIngredients: ['Arroz blanco', 'Pollo (pechuga)', 'Tomate'],
        durationMinutes: null,
      },
    ]);
    expect(findButton(tree, 'recipe-header-favorite').props.accessibilityLabel).toBe(
      'Quitar de favoritos'
    );
  });

  it('takes the star back when the server refuses the favorite', async () => {
    jest.mocked(addFavorite).mockRejectedValue(new ApiError('recipe_not_found', 'nope', 404));
    const tree = renderScreen();

    await act(async () => {
      findButton(tree, 'recipe-header-favorite').props.onPress();
    });

    expect(useFavoritesStore.getState().favorites).toEqual([]);
    expect(findButton(tree, 'recipe-header-favorite').props.accessibilityLabel).toBe(
      'Agregar a favoritos'
    );
  });

  it('unfavorites a favorite recipe at once and tells the server', async () => {
    useFavoritesStore.setState({
      favorites: [{ recipeId: 'r1', name: 'Pollo', mainIngredients: [], durationMinutes: null }],
    });
    jest.mocked(removeFavorite).mockReturnValue(new Promise(() => {}));
    const tree = await renderSettledScreen();

    press(tree, 'recipe-header-favorite');

    expect(removeFavorite).toHaveBeenCalledWith('r1');
    expect(findButton(tree, 'recipe-header-favorite').props.accessibilityLabel).toBe(
      'Agregar a favoritos'
    );
  });

  it('goes back from the header', async () => {
    const tree = await renderSettledScreen();

    press(tree, 'recipe-header-back');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('fades the scrolling content out under the header instead of cutting it', async () => {
    const tree = await renderSettledScreen();
    const mask = tree.root.findByType('TopFadeMask' as never);
    const scrollView = mask.findByType(ScrollView);
    // Top inset plus the height of the header.
    const headerBottom = 47 + 45;
    const contentTopPadding = StyleSheet.flatten(scrollView.props.contentContainerStyle).paddingTop;

    // The mask starts where the header ends: nothing shows behind the header buttons.
    expect(StyleSheet.flatten(mask.props.style).marginTop).toBe(headerBottom);
    expect(StyleSheet.flatten(scrollView.props.style).marginTop).toBeUndefined();
    // At rest the first card sits where it always did, 65 below the top inset, and the fade ends
    // 8 above it, which leaves the card and its shadow untouched.
    expect(headerBottom + contentTopPadding).toBe(47 + 65);
    expect(mask.props.fadeSize).toBe(12);
    expect(contentTopPadding - mask.props.fadeSize).toBe(8);
  });

  describe('a recipe from the API', () => {
    const API_RECIPE = fixtureRecipe();
    const RECIPE_URL = `https://api.example.test/api/recipes/${API_RECIPE.id}`;

    function jsonResponse(payload: unknown, status = 200) {
      return Promise.resolve({
        ok: status < 400,
        status,
        text: () => Promise.resolve(JSON.stringify(payload)),
      } as Response);
    }

    function errorResponse(code: string, status: number) {
      return jsonResponse({ error: { code, message: 'Request failed' } }, status);
    }

    // Lets the requests under way finish and the screen draw their answers.
    async function settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    function isShown(tree: ReactTestRenderer, testID: string) {
      return tree.root.findAllByProps({ testID }).length > 0;
    }

    function ingredientRow(tree: ReactTestRenderer, ingredientId: string) {
      const [row] = tree.root.findAllByProps({ testID: `recipe-ingredient-row-${ingredientId}` });

      return row.findAllByType(Text).map((node) => String(node.props.children));
    }

    beforeEach(() => {
      // The requests resolve on their own; nothing here waits for the chat.
      jest.useRealTimers();
      // These recipes are read from the server: the cache starts without any.
      useRecipeCacheStore.getState().clear();
      mockRouteParams = { id: API_RECIPE.id };
    });

    it('waits on a loading state, then draws the frozen payload with formatted quantities and facts', async () => {
      fetchMock.mockReturnValueOnce(jsonResponse(recipeDetail));
      const tree = renderScreen();

      expect(isShown(tree, 'recipe-loading')).toBe(true);
      expect(renderedTexts(tree)).toEqual([]);

      await settle();
      const texts = renderedTexts(tree);
      const stepTexts = API_RECIPE.steps.map((step) => step.text);

      expect(isShown(tree, 'recipe-loading')).toBe(false);
      expect(fetchMock).toHaveBeenCalledWith(
        RECIPE_URL,
        expect.objectContaining({ method: 'GET' })
      );
      expect(texts).toContain('Tortilla de papas');
      expect(API_RECIPE.ingredients.map((line) => ingredientRow(tree, line.ingredientId))).toEqual([
        ['500 g', 'Papa', 'Falta'],
        ['60 ml', 'Aceite de girasol', 'Falta'],
        ['4 u', 'Huevo', 'Falta'],
        ['1 u', 'Cebolla', 'Falta'],
      ]);
      expect(stepTexts).toHaveLength(3);
      expect(texts.filter((text) => stepTexts.includes(text))).toEqual(stepTexts);
      expect(texts).toContain('3 pasos');
      expect(shownFactLabels(tree)).toEqual(FACT_LABELS);
      expect(texts).toEqual(expect.arrayContaining(['4 porciones', '40 min', '$3.850']));
    });

    it('draws no servings, duration or cost for a recipe that knows none of them', async () => {
      fetchMock.mockReturnValueOnce(
        jsonResponse({
          data: {
            ...recipeDetail.data,
            servings: null,
            durationMinutes: null,
            estimatedCostCents: 0,
          },
        })
      );
      const tree = renderScreen();
      await settle();

      expect(renderedTexts(tree)).toContain('Tortilla de papas');
      expect(shownFactLabels(tree)).toEqual([]);
    });

    it('draws an ai_generated recipe exactly as it draws a catalog one', async () => {
      async function renderedTree(payload: unknown) {
        fetchMock.mockReturnValueOnce(jsonResponse(payload));
        const tree = renderScreen();
        await settle();
        // The whole render output. An element handed down as a prop points back at its owner.
        const serialized = JSON.stringify(tree.toJSON(), (key, value) =>
          key === '_owner' ? undefined : value
        );

        unmountScreen();
        useRecipeCacheStore.getState().clear();
        return serialized;
      }

      const catalog = await renderedTree(recipeDetail);
      const generated = await renderedTree({
        data: { ...recipeDetail.data, source: 'ai_generated' },
      });

      expect(recipeDetail.data.source).toBe('traditional');
      expect(catalog).toContain('Tortilla de papas');
      expect(generated).toBe(catalog);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('asks for a recipe once, however many times it is opened', async () => {
      fetchMock.mockReturnValue(jsonResponse(recipeDetail));
      renderScreen();
      await settle();
      unmountScreen();

      const reopened = renderScreen();

      // The cached version is there for the first paint, with no loading state in between.
      expect(renderedTexts(reopened)).toContain('Tortilla de papas');
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not ask for a version the cache has when the route names it', async () => {
      useRecipeCacheStore.setState({
        recipesByVersionId: { [API_RECIPE.recipeVersionId]: API_RECIPE },
        versionIdByRecipeId: {},
      });
      mockRouteParams = { id: API_RECIPE.id, recipeVersionId: API_RECIPE.recipeVersionId };

      const tree = renderScreen();
      await settle();

      expect(renderedTexts(tree)).toContain('Tortilla de papas');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains that the recipe was not found and still lets the user go back', async () => {
      fetchMock.mockReturnValueOnce(errorResponse('recipe_not_found', 404));
      mockRouteParams = { id: 'missing' };
      const tree = renderScreen();
      await settle();

      expect(renderedTexts(tree)).toEqual(['No encontramos esta receta']);

      press(tree, 'recipe-header-back');

      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('reads a route without a recipe id as not found, without asking the server', () => {
      mockRouteParams = { id: '' };

      expect(renderedTexts(renderScreen())).toEqual(['No encontramos esta receta']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains any other failure and loads the recipe when the user tries again', async () => {
      fetchMock
        .mockReturnValueOnce(errorResponse('internal_error', 500))
        .mockReturnValueOnce(jsonResponse(recipeDetail));
      const tree = renderScreen();
      await settle();

      expect(renderedTexts(tree)).toEqual(['No pudimos cargar esta receta', 'Reintentar']);

      press(tree, 'recipe-load-retry');

      expect(isShown(tree, 'recipe-loading')).toBe(true);
      await settle();
      expect(renderedTexts(tree)).toContain('Tortilla de papas');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('explains that the account has no access and offers no retry, which could not succeed', async () => {
      fetchMock.mockReturnValueOnce(errorResponse('forbidden', 403));
      const tree = renderScreen();
      await settle();

      expect(isShown(tree, 'recipe-forbidden')).toBe(true);
      expect(renderedTexts(tree)).toEqual(['Tu cuenta no tiene acceso a esta receta por ahora']);
      expect(isShown(tree, 'recipe-load-retry')).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      press(tree, 'recipe-header-back');

      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('reads a partial answer as a failure and keeps it out of the cache', async () => {
      fetchMock.mockReturnValueOnce(
        jsonResponse({ data: { ...recipeDetail.data, steps: undefined } })
      );
      const tree = renderScreen();
      await settle();

      expect(isShown(tree, 'recipe-load-error')).toBe(true);
      expect(useRecipeCacheStore.getState().recipesByVersionId).toEqual({});
      expect(useRecipeCacheStore.getState().versionIdByRecipeId).toEqual({});
    });

    it('drops an answer that arrives after the screen moved on to another recipe', async () => {
      const answers: ((response: Response) => void)[] = [];
      fetchMock.mockImplementation(() => new Promise<Response>((resolve) => answers.push(resolve)));
      const tree = renderScreen();
      await settle();

      mockRouteParams = { id: 'another-recipe' };
      act(() => {
        tree.update(<RecipeScreen />);
      });
      await settle();
      answers[0](await jsonResponse(recipeDetail));
      await settle();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(isShown(tree, 'recipe-loading')).toBe(true);
      expect(renderedTexts(tree)).toEqual([]);

      // The answer of the recipe the screen is on is the one it draws.
      answers[1](await errorResponse('recipe_not_found', 404));
      await settle();

      expect(renderedTexts(tree)).toEqual(['No encontramos esta receta']);
    });
  });

  describe('assistant chat', () => {
    const QUESTION = '¿Puedo hacerla más liviana?';

    // Opens the screen and waits for the session of today's meal, with the history it had.
    async function renderWithChatOpen(session = COOKING_START) {
      jest.mocked(getCookingSession).mockResolvedValue(session);
      const tree = renderScreen();
      await waitForReply();

      return tree;
    }

    it('invites the user to ask about the recipe on the day it is planned', async () => {
      const composer = getComposer(await renderSettledScreen());

      expect(composer.props.disabled).toBe(false);
      expect(composer.props.placeholder).toBe('Preguntale a la IA sobre la receta');
    });

    it('sits on the bottom safe area, since this route has no tab bar', async () => {
      expect(getComposer(await renderSettledScreen()).props.restingBottomGap).toBe(14);
    });

    it('disables the composer on any other day and keeps the recipe readable', async () => {
      useMealPlanStore.setState({ entries: [entry({ id: 'e-other', date: OTHER_DAY })] });
      mockRouteParams = { id: 'r1', entryId: 'e-other' };
      const tree = await renderSettledScreen();
      const composer = getComposer(tree);

      expect(composer.props.disabled).toBe(true);
      expect(composer.props.placeholder).toBe('Chat disponible el día de la receta');
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['Asistente de cocina', 'Arroz blanco', 'Cocinar el arroz.'])
      );
    });

    it('asks the server nothing while the chat is disabled', async () => {
      useMealPlanStore.setState({ entries: [entry({ id: 'e-other', date: OTHER_DAY })] });
      mockRouteParams = { id: 'r1', entryId: 'e-other' };
      const tree = renderScreen();

      ask(tree, QUESTION);
      await waitForReply();

      expect(renderedTexts(tree)).not.toContain(QUESTION);
      expect(tree.root.findAllByType('ChatTypingIndicator' as never)).toHaveLength(0);
      expect(startCookingSession).not.toHaveBeenCalled();
      expect(getCookingSession).not.toHaveBeenCalled();
      expect(askCookingSession).not.toHaveBeenCalled();
    });

    it('disables the composer when the recipe has no planned meal', async () => {
      useMealPlanStore.setState({ entries: [] });
      const tree = renderScreen();
      await waitForReply();

      expect(getComposer(tree).props.disabled).toBe(true);
      expect(startCookingSession).not.toHaveBeenCalled();
    });

    it('brings back the conversation of the meal when the screen opens', async () => {
      const tree = await renderWithChatOpen(COOKING_SESSION_WITH_HISTORY);

      expect(startCookingSession).toHaveBeenCalledWith('e-today');
      expect(getCookingSession).toHaveBeenCalledWith(COOKING_START.sessionId);
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['¿Puedo usar menos aceite?', 'Sí, con la mitad alcanza.'])
      );
    });

    it('shows the closed conversation of a meal that was already cooked today', async () => {
      useMealPlanStore.setState({ entries: [entry({ isCooked: true })] });
      jest.mocked(startCookingSession).mockResolvedValue(COOKING_SESSION_FINISHED);
      const tree = await renderWithChatOpen(COOKING_SESSION_FINISHED);

      expect(startCookingSession).toHaveBeenCalledWith('e-today');
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['¿Puedo usar menos aceite?', 'Sí, con la mitad alcanza.'])
      );
      expect(getComposer(tree).props.disabled).toBe(true);
      expect(getComposer(tree).props.placeholder).toBe('Chat cerrado: la comida ya está cocinada');
      expect(tree.root.findAllByProps({ testID: 'recipe-chat-error' })).toHaveLength(0);

      ask(tree, QUESTION);
      await waitForReply();
      expect(askCookingSession).not.toHaveBeenCalled();
    });

    it('shows the question, then the typing indicator, then the answer of the server', async () => {
      let answer: (value: typeof COOKING_ANSWER) => void = () => {};
      jest.mocked(askCookingSession).mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const tree = await renderWithChatOpen();

      ask(tree, QUESTION);
      await waitForReply();

      expect(askCookingSession).toHaveBeenCalledWith(
        COOKING_START.sessionId,
        QUESTION,
        expect.any(String)
      );
      expect(renderedTexts(tree)).toContain(QUESTION);
      expect(getComposer(tree).props.value).toBe('');
      expect(getComposer(tree).props.isThinking).toBe(true);
      expect(tree.root.findAllByType('ChatTypingIndicator' as never)).toHaveLength(1);

      await act(async () => answer(COOKING_ANSWER));

      expect(getComposer(tree).props.isThinking).toBe(false);
      expect(tree.root.findAllByType('ChatTypingIndicator' as never)).toHaveLength(0);
      // The stored turns replace the question the screen had drawn on its own.
      expect(renderedTexts(tree)).not.toContain(QUESTION);
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['¿Cuánto tarda el arroz?', 'Unos 18 minutos a fuego bajo.'])
      );
    });

    it('gives the question back and says why when the server cannot answer', async () => {
      jest.mocked(askCookingSession).mockRejectedValue(new ApiError('network_error', 'offline'));
      const tree = await renderWithChatOpen();

      ask(tree, QUESTION);
      await waitForReply();

      expect(getComposer(tree).props.value).toBe(QUESTION);
      expect(getComposer(tree).props.disabled).toBe(false);
      expect(tree.root.findAllByProps({ testID: 'recipe-chat-error' }).length).toBeGreaterThan(0);
      expect(renderedTexts(tree)).not.toContain(QUESTION);
    });

    it.each([
      ['cooking_chat_unavailable', 'Chat disponible el día de la receta'],
      ['cooking_already_finished', 'Chat cerrado: la comida ya está cocinada'],
    ] as const)('closes the composer when the server answers %s', async (code, placeholder) => {
      jest.mocked(askCookingSession).mockRejectedValue(new ApiError(code, 'no', 409));
      const tree = await renderWithChatOpen();

      ask(tree, QUESTION);
      await waitForReply();

      expect(getComposer(tree).props.disabled).toBe(true);
      expect(getComposer(tree).props.placeholder).toBe(placeholder);
      expect(getComposer(tree).props.value).toBe('');
    });

    it('closes the chat once the meal is cooked and keeps the conversation', async () => {
      const tree = await renderWithChatOpen(COOKING_SESSION_WITH_HISTORY);

      press(tree, 'recipe-header-cooked');
      await pressAndSettle(tree, 'recipe-cooked-confirm-yes');

      // Cooking finished the same session the chat was using.
      expect(finishCookingSession).toHaveBeenCalledWith(COOKING_START.sessionId);
      expect(getComposer(tree).props.disabled).toBe(true);
      expect(getComposer(tree).props.placeholder).toBe('Chat cerrado: la comida ya está cocinada');
      expect(renderedTexts(tree)).toContain('Sí, con la mitad alcanza.');
    });

    it('scrolls to the end once a new message has been laid out', async () => {
      const tree = await renderWithChatOpen();

      act(() => {
        getScrollView(tree).props.onContentSizeChange(390, 600);
      });

      expect(mockScrollToEnd).not.toHaveBeenCalled();

      ask(tree, QUESTION);
      act(() => {
        getScrollView(tree).props.onContentSizeChange(390, 700);
      });

      expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
      expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });

      await waitForReply();
      act(() => {
        getScrollView(tree).props.onContentSizeChange(390, 900);
      });

      expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
    });

    it('keeps the end of the conversation clear of the composer as it grows', async () => {
      const tree = await renderSettledScreen();
      const getBottomPadding = () =>
        StyleSheet.flatten(getScrollView(tree).props.contentContainerStyle).paddingBottom;
      const restingPadding = getBottomPadding();

      // Bottom inset, gap under the composer, the composer itself and the reach of the fade.
      expect(restingPadding).toBe(34 + 14 + CHAT_COMPOSER_MIN_HEIGHT + 30);

      act(() => {
        getComposer(tree).props.onHeightChange(CHAT_COMPOSER_MIN_HEIGHT + 48);
      });

      expect(getBottomPadding()).toBe(restingPadding + 48);
    });

    describe('with the keyboard open', () => {
      // How far the composer reports the keyboard lifts it above its resting position.
      const KEYBOARD_LIFT = 291;

      function reportKeyboardLift(tree: ReactTestRenderer, lift: number) {
        act(() => {
          getComposer(tree).props.onKeyboardLiftChange(lift);
        });
      }

      it('makes room for the lifted composer under the conversation and gives it back at rest', async () => {
        const tree = await renderSettledScreen();
        const getBottomPadding = () =>
          StyleSheet.flatten(getScrollView(tree).props.contentContainerStyle).paddingBottom;
        const restingPadding = getBottomPadding();

        reportKeyboardLift(tree, KEYBOARD_LIFT);

        expect(getBottomPadding()).toBe(restingPadding + KEYBOARD_LIFT);

        act(() => {
          getComposer(tree).props.onHeightChange(CHAT_COMPOSER_MIN_HEIGHT + 24);
        });

        expect(getBottomPadding()).toBe(restingPadding + KEYBOARD_LIFT + 24);

        reportKeyboardLift(tree, 0);

        expect(getBottomPadding()).toBe(restingPadding + 24);
      });

      it('scrolls to the end once the room for the keyboard has been laid out', async () => {
        const tree = await renderSettledScreen();

        reportKeyboardLift(tree, KEYBOARD_LIFT);

        // Scrolling before the taller content is measured would stop short of its new end.
        expect(mockScrollToEnd).not.toHaveBeenCalled();

        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
        expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });
      });

      it('keeps following the conversation while the keyboard stays open', async () => {
        const tree = await renderWithChatOpen();

        reportKeyboardLift(tree, KEYBOARD_LIFT);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600 + KEYBOARD_LIFT);
        });
        ask(tree, QUESTION);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 700 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(2);

        await waitForReply();
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 900 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(3);
      });

      it('follows a keyboard that grows taller while it is open', async () => {
        const tree = await renderSettledScreen();

        reportKeyboardLift(tree, KEYBOARD_LIFT);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600 + KEYBOARD_LIFT);
        });
        reportKeyboardLift(tree, KEYBOARD_LIFT + 40);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 640 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
      });

      it('hands the bottom fade to the composer, so the keyboard lifts both as one', async () => {
        const tree = await renderSettledScreen();
        const getBackdrop = () => getComposer(tree).props.backdrop;
        // Bottom inset, gap under the composer, the composer itself and the reach of the fade.
        const restingHeight = 34 + 14 + CHAT_COMPOSER_MIN_HEIGHT + 30;

        expect(getBackdrop().type).toBe(RecipeBottomFade);
        expect(getBackdrop().props.height).toBe(restingHeight);
        // No second fade left behind at the bottom of the screen, under the keyboard.
        expect(tree.root.findAllByType(RecipeBottomFade)).toHaveLength(0);

        reportKeyboardLift(tree, KEYBOARD_LIFT);

        // The fade travels with the composer; it does not stretch down to the keyboard.
        expect(getBackdrop().props.height).toBe(restingHeight);

        act(() => {
          getComposer(tree).props.onHeightChange(CHAT_COMPOSER_MIN_HEIGHT + 24);
        });

        expect(getBackdrop().props.height).toBe(restingHeight + 24);
      });

      it('leaves the scroll position alone when the keyboard closes', async () => {
        const tree = await renderSettledScreen();

        reportKeyboardLift(tree, KEYBOARD_LIFT);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600 + KEYBOARD_LIFT);
        });
        mockScrollToEnd.mockClear();

        reportKeyboardLift(tree, 0);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600);
        });

        expect(mockScrollToEnd).not.toHaveBeenCalled();
      });
    });
  });
});
