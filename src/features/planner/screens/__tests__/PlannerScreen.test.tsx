import React from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import {
  CUSTOM_TAB_BAR_CONTENT_HEIGHT,
  PLANNER_CHAT_INPUT_CLEARANCE,
  PLANNER_CHAT_INPUT_MIN_HEIGHT,
} from '../../constants';
import { PlannerScreen } from '../PlannerScreen';

const mockUseReducedMotion = jest.fn(() => false);

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

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#ffffff',
      colorLight: '#eeeeee',
      textBlack: '#111111',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

jest.mock('../../components', () => ({
  ...(() => {
    const { Text: MockText } = jest.requireActual('react-native') as typeof import('react-native');
    return {
      PlannerTypingIndicator: () => <MockText testID="planner-typing-indicator" />,
    };
  })(),
  PlannerHeader: 'PlannerHeader',
  PlannerChatInput: 'PlannerChatInput',
}));

interface ScrollHarness {
  tree: ReturnType<typeof create>;
  scrollTo: jest.Mock;
  scrollToEnd: jest.Mock;
}

function getScrollView(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByType(ScrollView);
}

function renderHarness(reduceMotion = false): ScrollHarness {
  mockUseReducedMotion.mockReturnValue(reduceMotion);
  const scrollTo = jest.fn();
  const scrollToEnd = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<PlannerScreen />, {
      createNodeMock: (element) =>
        element.type === 'RCTScrollView' ? { scrollTo, scrollToEnd } : null,
    });
  });

  return { tree: tree!, scrollTo, scrollToEnd };
}

function submitMessage(tree: ReturnType<typeof create>, message: string) {
  const composer = tree.root.findByProps({ value: '', isThinking: false });

  act(() => {
    composer.props.onChangeText(message);
  });
  act(() => {
    tree.root.findByProps({ value: message, isThinking: false }).props.onSubmit();
  });
}

function reportCommittedTurnLayout(tree: ReturnType<typeof create>) {
  const activeTurn = tree.root.findByProps({ testID: 'planner-active-turn-message' });
  const spacer = tree.root.findByProps({ testID: 'planner-turn-trailing-space' });
  const spacerHeight = StyleSheet.flatten(spacer.props.style).height;

  act(() => {
    activeTurn.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 426, width: 300, height: 54 } },
    });
    getScrollView(tree).props.onContentSizeChange(390, 510 + spacerHeight + 196);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockUseReducedMotion.mockReturnValue(false);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockUseReducedMotion.mockReset();
});

describe('PlannerScreen settled turn anchoring', () => {
  it('keeps the imperative ScrollView ref attached to the native node', () => {
    const { tree, scrollToEnd } = renderHarness();

    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
    act(() => tree.unmount());
  });

  it('uses one ScrollView with keyboard clearance and stable selectors', () => {
    const { tree } = renderHarness();

    expect(tree.root.findAllByType(KeyboardAvoidingView)).toHaveLength(0);

    const scrollView = getScrollView(tree);
    expect(scrollView.props.testID).toBe('planner-conversation-list');
    expect(scrollView.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(StyleSheet.flatten(scrollView.props.style)).toEqual({
      marginTop: 21,
      flex: 1,
      paddingHorizontal: 17.5,
    });
    expect(scrollView.props.contentContainerStyle.paddingBottom).toBe(
      PLANNER_CHAT_INPUT_MIN_HEIGHT +
        20 +
        CUSTOM_TAB_BAR_CONTENT_HEIGHT +
        PLANNER_CHAT_INPUT_CLEARANCE +
        28
    );
    expect(scrollView.props.onContentSizeChange).toEqual(expect.any(Function));
    expect(tree.root.findByProps({ testID: 'planner-initial-request-message' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'planner-turn-trailing-space' })).toBeDefined();

    const composer = tree.root.findByProps({ value: '', isThinking: false });
    expect(composer.props.onHeightChange).toEqual(expect.any(Function));
    // The composer reports its height through a single prop.
    expect(composer.props).not.toHaveProperty('onRenderedHeightChange');

    act(() => {
      composer.props.onHeightChange(180);
    });
    expect(getScrollView(tree).props.contentContainerStyle.paddingBottom).toBe(
      180 + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + PLANNER_CHAT_INPUT_CLEARANCE + 28
    );

    act(() => tree.unmount());
  });

  it('waits for the target offset to be reachable in the viewport and the next visible frame', () => {
    const { tree, scrollTo, scrollToEnd } = renderHarness();
    jest.spyOn(Date, 'now').mockReturnValue(1725100000000);

    act(() => {
      jest.advanceTimersByTime(16);
      getScrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    scrollToEnd.mockClear();

    submitMessage(tree, 'Plan dinner');
    expect(tree.root.findByProps({ testID: 'planner-active-turn-message' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'planner-typing-indicator' })).toBeDefined();

    const activeTurn = tree.root.findByProps({ testID: 'planner-active-turn-message' });
    act(() => {
      getScrollView(tree).props.onContentSizeChange(390, 1109);
      activeTurn.props.onLayout({ nativeEvent: { layout: { y: 426 } } });
    });
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      getScrollView(tree).props.onContentSizeChange(390, 1110);
    });
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 410, animated: true });
    const resultingMessageTop = 426 - scrollTo.mock.calls[0][0].y;
    expect(resultingMessageTop).toBeGreaterThanOrEqual(0);
    expect(resultingMessageTop).toBeLessThanOrEqual(32);
    expect(scrollToEnd).not.toHaveBeenCalled();

    act(() => tree.unmount());
  });

  it('keeps viewport-derived trailing extent after typing becomes a short reply', () => {
    const { tree, scrollTo } = renderHarness();

    act(() => {
      jest.advanceTimersByTime(16);
      getScrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    submitMessage(tree, 'Plan dinner');

    const expectedBottomClearance =
      PLANNER_CHAT_INPUT_MIN_HEIGHT +
      20 +
      CUSTOM_TAB_BAR_CONTENT_HEIGHT +
      PLANNER_CHAT_INPUT_CLEARANCE +
      28;
    const expectedTrailingExtent = 700 - expectedBottomClearance - 16;
    expect(
      StyleSheet.flatten(
        tree.root.findByProps({ testID: 'planner-turn-trailing-space' }).props.style
      ).height
    ).toBe(expectedTrailingExtent);

    reportCommittedTurnLayout(tree);
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    act(() => jest.runOnlyPendingTimers());

    expect(tree.root.findAllByProps({ testID: 'planner-typing-indicator' })).toHaveLength(0);
    expect(
      StyleSheet.flatten(
        tree.root.findByProps({ testID: 'planner-turn-trailing-space' }).props.style
      ).height
    ).toBe(expectedTrailingExtent);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    const renderedText = tree.root.findAllByType(Text).map((node) => node.props.children);
    expect(renderedText).toEqual(
      expect.arrayContaining([
        'EL domingo a la noche vienen 5 personas a mi casa y son vegetarianos. Despues el sabado tengo que preparar algo para llevar al a iglesia, para compartir pero son bastantes como 30 personas',
        'Te parece para el domingo hacer unos tacos vegetarianos? y para el sábado llevar unas empanadas de choclo y verdura?',
        'Si, me parece perfecto',
        'Plan dinner',
        'Tomé tu pedido. ¿Querés que además te prepare una lista de compras?',
      ])
    );

    act(() => tree.unmount());
  });

  it('does not issue a coordinate scroll from row layout alone', () => {
    const { tree, scrollTo } = renderHarness();

    act(() => jest.advanceTimersByTime(16));
    submitMessage(tree, 'Plan dinner');

    act(() => {
      tree.root.findByProps({ testID: 'planner-active-turn-message' }).props.onLayout({
        nativeEvent: { layout: { y: 426 } },
      });
      jest.advanceTimersByTime(32);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('anchors a later send when the unchanged trailing spacer does not lay out again', () => {
    const { tree, scrollTo } = renderHarness();
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1725100000000)
      .mockReturnValueOnce(1725100000001)
      .mockReturnValue(1725100000002);

    act(() => {
      jest.advanceTimersByTime(16);
      getScrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    submitMessage(tree, 'First request');
    const firstTurnLayout = tree.root.findByProps({
      testID: 'planner-active-turn-message',
    }).props.onLayout;
    reportCommittedTurnLayout(tree);
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    act(() => jest.runOnlyPendingTimers());
    scrollTo.mockClear();
    submitMessage(tree, 'Second request');

    act(() => {
      firstTurnLayout({ nativeEvent: { layout: { y: 999 } } });
      tree.root.findByProps({ testID: 'planner-active-turn-message' }).props.onLayout({
        nativeEvent: { layout: { y: 620 } },
      });
      getScrollView(tree).props.onContentSizeChange(390, 1304);
      jest.advanceTimersByTime(16);
    });

    expect(scrollTo).toHaveBeenCalledWith({ y: 604, animated: true });
    act(() => tree.unmount());
  });

  it('does not let a pending anchor override a user drag', () => {
    const { tree, scrollTo } = renderHarness();

    act(() => {
      jest.advanceTimersByTime(16);
      getScrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    submitMessage(tree, 'Plan dinner');
    reportCommittedTurnLayout(tree);

    act(() => {
      getScrollView(tree).props.onScrollBeginDrag();
      jest.advanceTimersByTime(16);
    });

    expect(scrollTo).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('cancels a settled anchor frame when the screen unmounts', () => {
    const { tree, scrollTo } = renderHarness();

    act(() => jest.advanceTimersByTime(16));
    submitMessage(tree, 'Plan dinner');
    reportCommittedTurnLayout(tree);
    act(() => tree.unmount());
    act(() => jest.advanceTimersByTime(32));

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('disables turn-anchor animation when reduced motion is enabled', () => {
    const { tree, scrollTo } = renderHarness(true);

    act(() => {
      jest.advanceTimersByTime(16);
      getScrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    submitMessage(tree, 'Plan dinner');
    reportCommittedTurnLayout(tree);
    act(() => jest.advanceTimersByTime(16));

    expect(scrollTo).toHaveBeenCalledWith({ y: 410, animated: false });
    act(() => tree.unmount());
  });
});
