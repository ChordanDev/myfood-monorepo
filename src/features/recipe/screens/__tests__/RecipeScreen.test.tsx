import React from 'react';
import { Keyboard, Modal, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { formatDateKey } from '@/features/home/utils/calendarDate';
import { CHAT_COMPOSER_MIN_HEIGHT } from '@/features/assistant-chat';
import { useInventoryStore, type InventoryItem } from '@/features/inventory';
import { useMealPlanStore } from '@/store';
import type { MasterRecipe, MealPlanEntry, RecipeThemeConfig } from '@/types/domain';
import { RecipeBottomFade } from '../../components/RecipeBottomFade';
import { RECIPE_CHAT_REPLY_DELAY_MS } from '../../hooks/useRecipeChat';
import { useShoppingRequestsStore } from '../../store/useShoppingRequestsStore';
import { RecipeScreen } from '../RecipeScreen';

const mockBack = jest.fn();
const mockScrollToEnd = jest.fn();
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

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'inv-i1',
    ingredientId: 'i1',
    name: 'Arroz Blanco',
    category: 'almacen',
    quantity: 500,
    unit: 'g',
    confidence: 'exact',
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

function waitForReply() {
  act(() => {
    jest.advanceTimersByTime(RECIPE_CHAT_REPLY_DELAY_MS);
  });
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
    jest.useFakeTimers();
    mockBack.mockClear();
    mockScrollToEnd.mockClear();
    mockRouteParams = { id: 'r1', entryId: 'e-today' };
    useMealPlanStore.setState({ entries: [entry()], recipes: [RECIPE], favoriteRecipeIds: [] });
    useInventoryStore.setState({
      items: [inventoryItem()],
      ingredients: [
        { id: 'i1', name: 'Arroz Blanco', category: 'almacen', basePrice: 2, unit: 'g' },
        { id: 'i2', name: 'Pollo (Pechuga)', category: 'carnes', basePrice: 10, unit: 'g' },
        { id: 'i3', name: 'Tomate', category: 'verduras', basePrice: 3, unit: 'unit' },
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
    jest.useRealTimers();
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
        unit: 'g',
      }),
    ]);
    expect(tree.root.findAllByProps({ testID: 'recipe-ingredient-add-i2' })).toHaveLength(0);
    expect(renderedTexts(tree)).toContain('En la lista');
  });

  it('asks only for the amount the inventory is short of', () => {
    useInventoryStore.setState({
      items: [
        inventoryItem(),
        inventoryItem({ id: 'inv-i2', ingredientId: 'i2', name: 'Pollo (Pechuga)', quantity: 50 }),
      ],
    });
    const tree = renderScreen();

    press(tree, 'recipe-ingredient-add-i2');

    expect(useShoppingRequestsStore.getState().requests[0]).toMatchObject({ amount: 150 });
  });

  it('does not count an inventory item without a catalog link as stock', () => {
    useInventoryStore.setState({
      items: [
        inventoryItem(),
        inventoryItem({ id: 'inv-free', ingredientId: undefined, name: 'Pollo', quantity: 900 }),
      ],
    });
    const tree = renderScreen();

    expect(renderedTexts(tree)).toContain('2 te faltan');

    press(tree, 'recipe-ingredient-add-i2');

    expect(useShoppingRequestsStore.getState().requests[0]).toMatchObject({
      ingredientId: 'i2',
      amount: 200,
    });
  });

  describe('marking the meal as cooked', () => {
    function isConfirmSheetOpen(tree: ReactTestRenderer) {
      return tree.root.findAllByProps({ testID: 'recipe-cooked-confirm-sheet' }).length > 0;
    }

    it('asks for confirmation instead of marking the meal right away', () => {
      const tree = renderScreen();

      expect(isConfirmSheetOpen(tree)).toBe(false);

      press(tree, 'recipe-header-cooked');

      expect(isConfirmSheetOpen(tree)).toBe(true);
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['¿Cocinaste la receta?', 'Sí', 'No'])
      );
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('marks the planned meal as cooked and goes back once the user answers "Sí"', () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      press(tree, 'recipe-cooked-confirm-yes');

      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(isConfirmSheetOpen(tree)).toBe(false);
    });

    it('marks the meal and goes back a single time when "Sí" is tapped twice', () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      // Both taps land before the screen re-renders, so they reach the same handler.
      const { onPress } = findButton(tree, 'recipe-cooked-confirm-yes').props;
      act(() => {
        onPress();
        onPress();
      });

      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('leaves the meal uncooked and the screen in place when the user answers "No"', () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      press(tree, 'recipe-cooked-confirm-no');

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
      expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(false);
    });

    it('asks again after a "No", and the next "Sí" still marks the meal', () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      press(tree, 'recipe-cooked-confirm-no');
      press(tree, 'recipe-header-cooked');
      press(tree, 'recipe-cooked-confirm-yes');

      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(true);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('closes without marking the meal from the backdrop and from the Android back button', () => {
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');
      act(() => {
        tree.root
          .findByProps({ accessibilityLabel: 'Cerrar', accessibilityRole: 'button' })
          .props.onPress();
      });

      expect(isConfirmSheetOpen(tree)).toBe(false);

      press(tree, 'recipe-header-cooked');
      act(() => {
        tree.root.findByType(Modal).props.onRequestClose();
      });

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('does not ask when the meal cannot be marked, even if the disabled check is pressed', () => {
      useMealPlanStore.setState({ entries: [entry({ isCooked: true })] });
      const tree = renderScreen();

      expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(true);

      press(tree, 'recipe-header-cooked');

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('does not ask for a meal that was skipped, and leaves it uncooked', () => {
      useMealPlanStore.setState({ entries: [entry({ isSkipped: true })] });
      const tree = renderScreen();

      expect(findButton(tree, 'recipe-header-cooked').props.disabled).toBe(true);

      press(tree, 'recipe-header-cooked');

      expect(isConfirmSheetOpen(tree)).toBe(false);
      expect(useMealPlanStore.getState().entries[0].isCooked).toBe(false);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('dismisses the keyboard before asking, so the sheet is not opened over it', () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
      const tree = renderScreen();

      press(tree, 'recipe-header-cooked');

      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(isConfirmSheetOpen(tree)).toBe(true);

      dismiss.mockRestore();
    });
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

  it('fades the scrolling content out under the header instead of cutting it', () => {
    const tree = renderScreen();
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

  it('explains that the recipe was not found and still lets the user go back', () => {
    mockRouteParams = { id: 'missing' };
    const tree = renderScreen();

    expect(renderedTexts(tree)).toEqual(['No encontramos esta receta']);

    press(tree, 'recipe-header-back');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
  describe('assistant chat', () => {
    const QUESTION = '¿Puedo hacerla más liviana?';

    it('invites the user to ask about the recipe on the day it is planned', () => {
      const composer = getComposer(renderScreen());

      expect(composer.props.disabled).toBe(false);
      expect(composer.props.placeholder).toBe('Preguntale a la IA sobre la receta');
    });

    it('sits on the bottom safe area, since this route has no tab bar', () => {
      expect(getComposer(renderScreen()).props.restingBottomGap).toBe(14);
    });

    it('disables the composer on any other day and keeps the recipe readable', () => {
      useMealPlanStore.setState({ entries: [entry({ id: 'e-other', date: OTHER_DAY })] });
      mockRouteParams = { id: 'r1', entryId: 'e-other' };
      const tree = renderScreen();
      const composer = getComposer(tree);

      expect(composer.props.disabled).toBe(true);
      expect(composer.props.placeholder).toBe('Chat disponible el día de la receta');
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['Asistente de cocina', 'Arroz blanco', 'Cocinar el arroz.'])
      );
    });

    it('sends nothing while the chat is disabled', () => {
      useMealPlanStore.setState({ entries: [entry({ id: 'e-other', date: OTHER_DAY })] });
      mockRouteParams = { id: 'r1', entryId: 'e-other' };
      const tree = renderScreen();

      ask(tree, QUESTION);
      waitForReply();

      expect(renderedTexts(tree)).not.toContain(QUESTION);
      expect(tree.root.findAllByType('ChatTypingIndicator' as never)).toHaveLength(0);
    });

    it('disables the composer when the recipe has no planned meal', () => {
      useMealPlanStore.setState({ entries: [] });

      expect(getComposer(renderScreen()).props.disabled).toBe(true);
    });

    it('shows the question, then the typing indicator, then the assistant reply', () => {
      const tree = renderScreen();

      ask(tree, QUESTION);

      expect(renderedTexts(tree)).toContain(QUESTION);
      expect(getComposer(tree).props.value).toBe('');
      expect(getComposer(tree).props.isThinking).toBe(true);
      expect(tree.root.findAllByType('ChatTypingIndicator' as never)).toHaveLength(1);

      waitForReply();

      expect(getComposer(tree).props.isThinking).toBe(false);
      expect(tree.root.findAllByType('ChatTypingIndicator' as never)).toHaveLength(0);
      expect(renderedTexts(tree).some((text) => text.includes('¿lo agrego a compras?'))).toBe(true);
      expect(renderedTexts(tree)).toEqual(
        expect.arrayContaining(['Sí, agregalo', 'No hace falta'])
      );
    });

    it('adds the offered ingredient to the shopping requests when the user confirms', () => {
      const tree = renderScreen();

      ask(tree, QUESTION);
      waitForReply();
      press(tree, 'recipe-chat-action-turn-1-assistant-confirm_add');

      expect(useShoppingRequestsStore.getState().requests).toEqual([
        expect.objectContaining({ ingredientId: 'i2', amount: 200, unit: 'g' }),
      ]);
      expect(tree.root.findAllByProps({ testID: 'recipe-ingredient-add-i2' })).toHaveLength(0);
      expect(renderedTexts(tree)).toContain('En la lista');
      expect(
        tree.root.findAllByProps({ testID: 'recipe-chat-action-turn-1-assistant-confirm_add' })
      ).toHaveLength(0);
      expect(
        tree.root.findAllByProps({ testID: 'recipe-chat-action-turn-1-assistant-dismiss_add' })
      ).toHaveLength(0);
    });

    it('adds nothing when the user dismisses the offer', () => {
      const tree = renderScreen();

      ask(tree, QUESTION);
      waitForReply();
      press(tree, 'recipe-chat-action-turn-1-assistant-dismiss_add');

      expect(useShoppingRequestsStore.getState().requests).toEqual([]);
      expect(
        tree.root.findAllByProps({ testID: 'recipe-chat-action-turn-1-assistant-dismiss_add' })
      ).toHaveLength(0);
      expect(findButton(tree, 'recipe-ingredient-add-i2')).toBeTruthy();
    });

    it('scrolls to the end once a new message has been laid out', () => {
      const tree = renderScreen();

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

      waitForReply();
      act(() => {
        getScrollView(tree).props.onContentSizeChange(390, 900);
      });

      expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
    });

    it('keeps the end of the conversation clear of the composer as it grows', () => {
      const tree = renderScreen();
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

      it('makes room for the lifted composer under the conversation and gives it back at rest', () => {
        const tree = renderScreen();
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

      it('scrolls to the end once the room for the keyboard has been laid out', () => {
        const tree = renderScreen();

        reportKeyboardLift(tree, KEYBOARD_LIFT);

        // Scrolling before the taller content is measured would stop short of its new end.
        expect(mockScrollToEnd).not.toHaveBeenCalled();

        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
        expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });
      });

      it('keeps following the conversation while the keyboard stays open', () => {
        const tree = renderScreen();

        reportKeyboardLift(tree, KEYBOARD_LIFT);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 600 + KEYBOARD_LIFT);
        });
        ask(tree, QUESTION);
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 700 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(2);

        waitForReply();
        act(() => {
          getScrollView(tree).props.onContentSizeChange(390, 900 + KEYBOARD_LIFT);
        });

        expect(mockScrollToEnd).toHaveBeenCalledTimes(3);
      });

      it('follows a keyboard that grows taller while it is open', () => {
        const tree = renderScreen();

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

      it('hands the bottom fade to the composer, so the keyboard lifts both as one', () => {
        const tree = renderScreen();
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

      it('leaves the scroll position alone when the keyboard closes', () => {
        const tree = renderScreen();

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
