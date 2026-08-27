import React from 'react';
import { KeyboardAvoidingView, ScrollView, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import {
  CUSTOM_TAB_BAR_CONTENT_HEIGHT,
  PLANNER_CHAT_INPUT_CLEARANCE,
  PLANNER_CHAT_INPUT_MIN_HEIGHT,
} from '../../constants';
import { PlannerScreen } from '../PlannerScreen';

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

jest.mock('../../components', () => ({
  ...(() => {
    const { Text: MockText } = jest.requireActual('react-native') as typeof import('react-native');
    return {
      PlannerTypingIndicator: ({ onLayout }: { onLayout?: () => void }) => (
        <MockText testID="planner-typing-indicator" onLayout={onLayout} />
      ),
    };
  })(),
  PlannerHeader: 'PlannerHeader',
  PlannerChatInput: 'PlannerChatInput',
}));

describe('PlannerScreen keyboard layout', () => {
  it('renders the preserved scroll and composer paths without KeyboardAvoidingView', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerScreen />);
    });

    expect(tree!.root.findAllByType(KeyboardAvoidingView)).toHaveLength(0);

    const scrollView = tree!.root.findByType(ScrollView);
    expect(scrollView.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scrollView.props.contentContainerStyle.paddingBottom).toBe(
      PLANNER_CHAT_INPUT_MIN_HEIGHT +
        20 +
        CUSTOM_TAB_BAR_CONTENT_HEIGHT +
        PLANNER_CHAT_INPUT_CLEARANCE +
        28
    );

    const textNodes = tree!.root.findAllByType(Text);
    expect(textNodes.map((node) => node.props.className).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'text-[16px] font-medium leading-relaxed',
        'text-[16px] font-bold leading-relaxed',
      ])
    );

    const composer = tree!.root.findByProps({ value: '', isThinking: false });
    expect(composer.props.value).toBe('');
    expect(composer.props.isThinking).toBe(false);
    expect(composer.props.onChangeText).toEqual(expect.any(Function));
    expect(composer.props.onHeightChange).toEqual(expect.any(Function));
    expect(composer.props.onRenderedHeightChange).toEqual(expect.any(Function));
    expect(composer.props.onSubmit).toEqual(expect.any(Function));

    act(() => {
      composer.props.onRenderedHeightChange(180);
    });
    expect(tree!.root.findByType(ScrollView).props.contentContainerStyle.paddingBottom).toBe(
      180 + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + PLANNER_CHAT_INPUT_CLEARANCE + 28
    );

    act(() => tree!.unmount());
  });

  it('shows the typing indicator for the thinking lifecycle and removes it after the reply', () => {
    jest.useFakeTimers();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerScreen />);
    });

    expect(tree!.root.findAllByProps({ testID: 'planner-typing-indicator' })).toHaveLength(0);

    const composer = tree!.root.findByProps({ value: '', isThinking: false });
    act(() => {
      composer.props.onChangeText('Plan dinner');
    });

    const thinkingComposer = tree!.root.findByProps({ value: 'Plan dinner', isThinking: false });
    act(() => {
      thinkingComposer.props.onSubmit();
    });

    expect(
      tree!.root.findAllByProps({ testID: 'planner-typing-indicator' }).length
    ).toBeGreaterThan(0);
    expect(tree!.root.findByProps({ value: '', isThinking: true })).toBeDefined();

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(tree!.root.findAllByProps({ testID: 'planner-typing-indicator' })).toHaveLength(0);
    expect(tree!.root.findByProps({ value: '', isThinking: false })).toBeDefined();

    act(() => tree!.unmount());
    jest.useRealTimers();
  });

  it('schedules bottom-follow after typing and reply mount, then confirms their final layout', () => {
    jest.useFakeTimers();
    const scrollToEnd = jest.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerScreen />);
    });

    const scrollView = tree!.root.findByType(ScrollView);
    (scrollView.props.ref as { current: unknown }).current = { scrollToEnd };

    act(() => {
      jest.advanceTimersByTime(16);
    });
    scrollToEnd.mockClear();

    const composer = tree!.root.findByProps({ value: '', isThinking: false });
    act(() => {
      composer.props.onChangeText('Plan dinner');
    });
    const readyComposer = tree!.root.findByProps({ value: 'Plan dinner', isThinking: false });
    act(() => {
      readyComposer.props.onSubmit();
    });
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);

    const typingIndicator = tree!.root.findByProps({ testID: 'planner-typing-indicator' });
    act(() => {
      typingIndicator.props.onLayout();
      jest.advanceTimersByTime(16);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(2968);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(3);

    const latestAssistantMessage = tree!.root
      .findAllByProps({ className: 'max-w-[94%] px-1' })
      .at(-1);
    expect(latestAssistantMessage?.props.onLayout).toEqual(expect.any(Function));
    act(() => {
      latestAssistantMessage!.props.onLayout();
      jest.advanceTimersByTime(16);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(4);

    act(() => tree!.unmount());
    jest.useRealTimers();
  });
});
