import React from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { createSocketClient, type SocketClient } from '@/api/socket/socketClient';
import { createFakeSocket, type FakeSocket } from '@/api/socket/testing/fakeSocket';
import { CHAT_COMPOSER_CLEARANCE, CHAT_COMPOSER_MIN_HEIGHT } from '@/features/assistant-chat';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '../../constants';
import { PlannerScreen } from '../PlannerScreen';

const mockUseReducedMotion = jest.fn(() => false);
const mockTypingIndicatorRender = jest.fn();
let mockSocketClient: SocketClient;
// No Account by default: the screen joins no topic unless a test signs one in.
let mockAccountId: string | null = null;

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
      textDark: '#222222',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

jest.mock('lucide-react-native', () => ({ CircleAlert: 'CircleAlert' }));

// The header is another suite's; the other components are rendered as they are.
jest.mock('../../components', () => ({
  ...jest.requireActual('../../components/PlanningJoinNotice'),
  ...jest.requireActual('../../components/PlanningDraftPanel'),
  PlannerHeader: 'PlannerHeader',
}));

// The range is another suite's too: it reads the plan store and the Home barrel, which loads
// that feature's screens.
jest.mock('../../hooks/usePlanningRange', () => ({
  usePlanningRange: () => ({ range: { start: '2030-01-01', end: '2030-01-02' } }),
}));

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
}));

// The real barrel would load the app client, and with it the Phoenix client.
jest.mock('@/api/socket', () => ({
  ...jest.requireActual('@/api/socket/topics'),
  getSocketClient: () => mockSocketClient,
}));

jest.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ me: mockAccountId === null ? null : { account: { id: mockAccountId } } }),
}));

// The real barrel would load the composer, which this suite's reanimated mock cannot evaluate, so
// the constants come from their own module.
jest.mock('@/features/assistant-chat', () => ({
  ...jest.requireActual('@/features/assistant-chat/constants'),
  ...(() => {
    const { Text: MockText } = jest.requireActual('react-native') as typeof import('react-native');
    return {
      ChatTypingIndicator: () => {
        mockTypingIndicatorRender();
        return <MockText testID="planner-typing-indicator" />;
      },
    };
  })(),
  ChatComposer: 'ChatComposer',
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

interface TurnLayout {
  activeTurnY: number;
  trailingSpaceY: number;
}

function renderLaidOutHarness(): ScrollHarness {
  const harness = renderHarness();

  act(() => {
    jest.advanceTimersByTime(16);
    getScrollView(harness.tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
  });

  return harness;
}

function getTrailingSpace(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-turn-trailing-space' });
}

function getTrailingSpaceHeight(tree: ReturnType<typeof create>): number {
  return StyleSheet.flatten(getTrailingSpace(tree).props.style).height;
}

function getBottomClearance(tree: ReturnType<typeof create>): number {
  return getScrollView(tree).props.contentContainerStyle.paddingBottom;
}

function reportActiveTurnY(tree: ReturnType<typeof create>, y: number) {
  act(() => {
    tree.root.findByProps({ testID: 'planner-active-turn-message' }).props.onLayout({
      nativeEvent: { layout: { y } },
    });
  });
}

function reportTrailingSpaceY(
  tree: ReturnType<typeof create>,
  y: number,
  height = getTrailingSpaceHeight(tree)
) {
  act(() => {
    getTrailingSpace(tree).props.onLayout({ nativeEvent: { layout: { y, height } } });
  });
}

// The content ends with the trailing space and the bottom clearance, as rendered right now.
function getContentHeight(tree: ReturnType<typeof create>, trailingSpaceY: number): number {
  return trailingSpaceY + getTrailingSpaceHeight(tree) + getBottomClearance(tree);
}

function reportContentHeight(tree: ReturnType<typeof create>, height: number) {
  act(() => {
    getScrollView(tree).props.onContentSizeChange(390, height);
  });
}

function reportTurnLayout(tree: ReturnType<typeof create>, layout: TurnLayout) {
  reportActiveTurnY(tree, layout.activeTurnY);
  reportTrailingSpaceY(tree, layout.trailingSpaceY);
  reportContentHeight(tree, getContentHeight(tree, layout.trailingSpaceY));
}

// While it reserves anything, the trailing space makes the content exactly as tall as the anchored
// offset needs (the active turn 16dp below the top of the 700dp viewport), so nothing scrolls past.
function expectAnchoredOffsetToBeTheFurthest(tree: ReturnType<typeof create>, layout: TurnLayout) {
  expect(getTrailingSpaceHeight(tree)).toBeGreaterThan(0);
  expect(getContentHeight(tree, layout.trailingSpaceY)).toBe(layout.activeTurnY - 16 + 700);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockUseReducedMotion.mockReturnValue(false);
  mockAccountId = null;
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
    // The bottom clearance already includes the safe area, so iOS must not add it a second time.
    expect(scrollView.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(StyleSheet.flatten(scrollView.props.style)).toEqual({
      marginTop: 21,
      flex: 1,
      paddingHorizontal: 17.5,
    });
    expect(scrollView.props.contentContainerStyle.paddingBottom).toBe(
      CHAT_COMPOSER_MIN_HEIGHT + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE + 28
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
      180 + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE + 28
    );

    act(() => tree.unmount());
  });

  it('rests the composer above the tab bar under the planner testID prefix', () => {
    const { tree } = renderHarness();
    const composer = tree.root.findByProps({ value: '', isThinking: false });

    expect(composer.props.restingBottomGap).toBe(
      CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE
    );
    expect(composer.props.restingBottomGap).toBe(72);
    expect(composer.props.testIDPrefix).toBe('planner-composer');

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
      getScrollView(tree).props.onContentSizeChange(390, 1108);
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

  it('gives a short reply the room it takes from the trailing extent', () => {
    const { tree, scrollTo } = renderHarness();

    act(() => {
      jest.advanceTimersByTime(16);
      getScrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    submitMessage(tree, 'Plan dinner');

    const expectedBottomClearance =
      CHAT_COMPOSER_MIN_HEIGHT + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE + 28;
    const expectedTrailingExtent = 700 - expectedBottomClearance - 16;
    expect(getTrailingSpaceHeight(tree)).toBe(expectedTrailingExtent);

    // A 54dp message, the 28dp list gap, a 24dp typing indicator and the gap again.
    reportTurnLayout(tree, { activeTurnY: 426, trailingSpaceY: 560 });
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(getTrailingSpaceHeight(tree)).toBe(expectedTrailingExtent - 134);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 560 });

    act(() => jest.runOnlyPendingTimers());

    expect(tree.root.findAllByProps({ testID: 'planner-typing-indicator' })).toHaveLength(0);
    // The 52dp reply takes the place of the typing indicator.
    reportTrailingSpaceY(tree, 588);
    expect(getTrailingSpaceHeight(tree)).toBe(expectedTrailingExtent - 162);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 588 });
    expect(getContentHeight(tree, 588)).toBe(1110);
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

  it('anchors when pixel rounding leaves the content half a point short', () => {
    const { tree, scrollTo } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 560);
    // The anchored offset needs 410 + 700.
    reportContentHeight(tree, 1109.5);
    act(() => jest.advanceTimersByTime(16));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 410, animated: true });
    act(() => tree.unmount());
  });

  it('does not anchor while the content is two points short', () => {
    const { tree, scrollTo } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 560);
    reportContentHeight(tree, 1108);
    act(() => jest.advanceTimersByTime(32));

    expect(scrollTo).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('applies the same rounding tolerance on the frame that issues the scroll', () => {
    const { tree, scrollTo } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 560);

    // The content shrinks between the readiness check and the frame it scheduled.
    reportContentHeight(tree, 1110);
    reportContentHeight(tree, 1108);
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).not.toHaveBeenCalled();

    reportContentHeight(tree, 1110);
    reportContentHeight(tree, 1109.5);
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 410, animated: true });

    act(() => tree.unmount());
  });
});

describe('PlannerScreen turn trailing space', () => {
  it('reserves nothing before the first send', () => {
    const { tree } = renderLaidOutHarness();

    reportTrailingSpaceY(tree, 426);

    expect(getTrailingSpaceHeight(tree)).toBe(0);
    act(() => tree.unmount());
  });

  it.each([
    { measured: 'neither row', activeTurnY: null, trailingSpaceY: null },
    { measured: 'only the active turn', activeTurnY: 426, trailingSpaceY: null },
    { measured: 'only the trailing space', activeTurnY: null, trailingSpaceY: 560 },
  ])('reserves the full extent while $measured is measured', ({ activeTurnY, trailingSpaceY }) => {
    const { tree } = renderLaidOutHarness();

    // Laid out before the send, where the new message is about to go.
    reportTrailingSpaceY(tree, 426);
    submitMessage(tree, 'Plan dinner');
    if (activeTurnY !== null) reportActiveTurnY(tree, activeTurnY);
    if (trailingSpaceY !== null) reportTrailingSpaceY(tree, trailingSpaceY);

    // The usable viewport (700 - 192) below the 16dp anchor inset.
    expect(getTrailingSpaceHeight(tree)).toBe(492);
    act(() => tree.unmount());
  });

  it('reserves only what the turn leaves empty once both rows are measured', () => {
    const { tree, scrollTo } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    // A 54dp message, the 28dp list gap, a 24dp typing indicator and the gap again.
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 560);

    expect(getBottomClearance(tree)).toBe(192);
    expect(getTrailingSpaceHeight(tree)).toBe(358);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 560 });

    // The content is now exactly as tall as the anchored offset needs.
    reportContentHeight(tree, getContentHeight(tree, 560));
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 410, animated: true });
    expect(getContentHeight(tree, 560) - 700).toBe(scrollTo.mock.calls[0][0].y);

    act(() => tree.unmount());
  });

  it('keeps the content height when the reply replaces the typing indicator', () => {
    const { tree } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportTurnLayout(tree, { activeTurnY: 426, trailingSpaceY: 560 });
    const contentHeightWhileThinking = getContentHeight(tree, 560);

    act(() => jest.runOnlyPendingTimers());
    expect(tree.root.findAllByProps({ testID: 'planner-typing-indicator' })).toHaveLength(0);
    // The 52dp reply is 28dp taller than the typing indicator.
    reportTrailingSpaceY(tree, 588);

    expect(getTrailingSpaceHeight(tree)).toBe(330);
    expect(getContentHeight(tree, 588)).toBe(contentHeightWhileThinking);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 588 });

    act(() => tree.unmount());
  });

  it('keeps reserving until the turn fills the usable viewport', () => {
    const { tree } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 917);

    expect(getTrailingSpaceHeight(tree)).toBe(1);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 917 });
    act(() => tree.unmount());
  });

  it.each([918, 1500])(
    'reserves nothing below a turn that ends at %p, past the usable viewport',
    (trailingSpaceY) => {
      const { tree } = renderLaidOutHarness();

      submitMessage(tree, 'Plan dinner');
      reportActiveTurnY(tree, 426);
      reportTrailingSpaceY(tree, trailingSpaceY);

      expect(getTrailingSpaceHeight(tree)).toBe(0);
      act(() => tree.unmount());
    }
  );

  it('keeps the anchored offset the furthest one when the composer height changes', () => {
    const { tree } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 560);
    expect(getTrailingSpaceHeight(tree)).toBe(358);

    const composer = tree.root.findByProps({ value: '', isThinking: true });
    act(() => {
      composer.props.onHeightChange(180);
    });
    expect(getBottomClearance(tree)).toBe(300);
    expect(getTrailingSpaceHeight(tree)).toBe(250);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 560 });

    act(() => {
      composer.props.onHeightChange(312);
    });
    expect(getBottomClearance(tree)).toBe(432);
    expect(getTrailingSpaceHeight(tree)).toBe(118);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 560 });

    act(() => {
      composer.props.onHeightChange(CHAT_COMPOSER_MIN_HEIGHT);
    });
    expect(getTrailingSpaceHeight(tree)).toBe(358);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 560 });

    act(() => tree.unmount());
  });

  it('reserves nothing once a taller composer leaves the turn no spare room', () => {
    const { tree } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    // A 360dp turn fits the 492dp below the anchor with 132dp to spare.
    reportActiveTurnY(tree, 426);
    reportTrailingSpaceY(tree, 786);
    expect(getTrailingSpaceHeight(tree)).toBe(132);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 426, trailingSpaceY: 786 });

    // A 312dp composer leaves 252dp below the anchor.
    act(() => {
      tree.root.findByProps({ value: '', isThinking: true }).props.onHeightChange(312);
    });
    expect(getTrailingSpaceHeight(tree)).toBe(0);

    // No usable viewport is left at all.
    act(() => {
      tree.root.findByProps({ value: '', isThinking: true }).props.onHeightChange(600);
    });
    expect(getTrailingSpaceHeight(tree)).toBe(0);

    act(() => tree.unmount());
  });

  it('falls back to the full extent when another message is sent', () => {
    const { tree, scrollTo } = renderLaidOutHarness();

    submitMessage(tree, 'First request');
    const firstTurnLayout = tree.root.findByProps({
      testID: 'planner-active-turn-message',
    }).props.onLayout;
    reportTurnLayout(tree, { activeTurnY: 426, trailingSpaceY: 560 });
    act(() => jest.runOnlyPendingTimers());
    reportTrailingSpaceY(tree, 588);
    expect(getTrailingSpaceHeight(tree)).toBe(330);
    scrollTo.mockClear();

    submitMessage(tree, 'Second request');
    expect(getTrailingSpaceHeight(tree)).toBe(492);

    // Layouts left over from the first turn do not size the second one.
    act(() => {
      firstTurnLayout({ nativeEvent: { layout: { y: 426 } } });
    });
    reportTrailingSpaceY(tree, 588);
    expect(getTrailingSpaceHeight(tree)).toBe(492);

    // The second message goes where the trailing space was.
    reportActiveTurnY(tree, 588);
    expect(getTrailingSpaceHeight(tree)).toBe(492);

    reportTrailingSpaceY(tree, 722);
    expect(getTrailingSpaceHeight(tree)).toBe(358);
    expectAnchoredOffsetToBeTheFurthest(tree, { activeTurnY: 588, trailingSpaceY: 722 });

    reportContentHeight(tree, getContentHeight(tree, 722));
    act(() => jest.advanceTimersByTime(16));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 572, animated: true });

    act(() => tree.unmount());
  });

  it('keeps sizing the trailing space after a user drag cancels the anchor', () => {
    const { tree, scrollTo } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    act(() => {
      getScrollView(tree).props.onScrollBeginDrag();
    });
    reportTurnLayout(tree, { activeTurnY: 426, trailingSpaceY: 560 });
    act(() => jest.advanceTimersByTime(16));

    expect(getTrailingSpaceHeight(tree)).toBe(358);
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('does not feed the height it gives the trailing space back into the reservation', () => {
    const { tree } = renderLaidOutHarness();

    submitMessage(tree, 'Plan dinner');
    reportActiveTurnY(tree, 426);
    // First laid out with the full reservation it was rendered with.
    reportTrailingSpaceY(tree, 560, 492);
    expect(getTrailingSpaceHeight(tree)).toBe(358);

    // The native side lays the trailing space out again for every height it is given.
    mockTypingIndicatorRender.mockClear();
    reportTrailingSpaceY(tree, 560, 358);
    reportTrailingSpaceY(tree, 560, 0);
    reportTrailingSpaceY(tree, 560, 492);
    reportActiveTurnY(tree, 426);

    expect(getTrailingSpaceHeight(tree)).toBe(358);
    expect(mockTypingIndicatorRender).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe('PlannerScreen planning topic', () => {
  let socket: FakeSocket;

  function refusal(code: string) {
    return { error: { code, message: 'refused' } };
  }

  function findJoinNotices(tree: ReturnType<typeof create>): ReactTestInstance[] {
    return tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'alert'
    );
  }

  function getJoinNoticeText(tree: ReturnType<typeof create>): string {
    const [notice, ...others] = findJoinNotices(tree);

    expect(others).toEqual([]);
    return notice.findByType(Text).props.children;
  }

  beforeEach(() => {
    mockAccountId = 'account-1';
    mockSocketClient = createSocketClient({
      url: 'wss://api.example.test/socket',
      createSocket: (url, options) => {
        socket = createFakeSocket(url, options);
        return socket;
      },
      getAccessToken: async () => 'access-1',
      refreshTokens: jest.fn(),
      subscribeToAccessToken: () => () => {},
    });
  });

  it("joins the Account's planning topic and shows no notice while it joins", () => {
    const { tree } = renderHarness();

    expect(socket.channels.map((channel) => channel.topic)).toEqual(['planning:account-1']);
    expect(findJoinNotices(tree)).toEqual([]);

    act(() => tree.unmount());
    expect(socket.channels[0].hasLeft()).toBe(true);
  });

  it('shows no notice once the topic is joined', () => {
    const { tree } = renderHarness();

    act(() => socket.channels[0].replyOk());

    expect(findJoinNotices(tree)).toEqual([]);
    act(() => tree.unmount());
  });

  it.each([
    { code: 'trial_expired', reason: 'Tu período de prueba terminó.' },
    { code: 'forbidden', reason: 'No tenés permiso para hacer esto.' },
  ])('shows the reason of a join refused as $code', ({ code, reason }) => {
    const { tree } = renderHarness();

    act(() => socket.channels[0].replyError(refusal(code)));

    expect(getJoinNoticeText(tree)).toBe(reason);
    act(() => tree.unmount());
  });

  it('keeps the conversation and the composer in place under a refused join', () => {
    const { tree } = renderHarness();

    act(() => socket.channels[0].replyError(refusal('trial_expired')));

    expect(tree.root.findByProps({ testID: 'planner-initial-request-message' })).toBeDefined();
    expect(tree.root.findByProps({ value: '', isThinking: false })).toBeDefined();
    act(() => tree.unmount());
  });

  it.each(['session_expired', 'session_lost_lock'])(
    'tells the user the session is over on %s',
    (event) => {
      const { tree } = renderHarness();
      act(() => socket.channels[0].replyOk());

      act(() => socket.channels[0].serverPush(event, {}));

      expect(getJoinNoticeText(tree)).toBe(
        'Esta sesión de planificación terminó. Empezá una nueva para seguir.'
      );
      act(() => tree.unmount());
    }
  );
});
